'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Regulatory Submission Service
 * ============================================================================
 *
 * File:
 * backend/modules/compliance/regulatory/RegulatorySubmissionService.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Durable application-service boundary for regulatory report submission.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Resolve tenant-scoped regulatory adapter
 * - Validate report identity and tenant context
 * - Validate regulatory calendar / filing window
 * - Validate report before submission
 * - Transform report through the adapter
 * - Generate deterministic submission idempotency identity
 * - Coordinate durable submission ownership
 * - Prevent duplicate regulator submissions
 * - Submit through the concrete adapter
 * - Normalize regulator responses
 * - Normalize acknowledgements
 * - Persist submission lifecycle
 * - Support status polling
 * - Support amendment and cancellation
 * - Preserve audit / correlation context
 * - Classify retryable failures
 * - Provide health/readiness/diagnostics
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Country-specific regulatory rules
 * - Regulator schemas
 * - Filing thresholds
 * - Filing calendars
 * - Regulator transport implementation
 * - Regulator authentication
 * - Ledger posting
 * - Financial calculations
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Regulatory Report
 *        │
 *        ▼
 * RegulatorySubmissionService
 *        │
 *        ├── RegulatoryAdapterRegistry
 *        │
 *        ├── RegulatoryCalendarService
 *        │
 *        ├── Submission Repository
 *        │
 *        ├── Idempotency / Claim
 *        │
 *        └── Audit / Metrics / Logger
 *                    │
 *                    ▼
 *            Concrete Regulatory Adapter
 *                    │
 *              ┌─────┴─────┐
 *              ▼           ▼
 *          Submit       Acknowledge
 *
 * Lifecycle
 * ----------------------------------------------------------------------------
 *
 * DRAFT
 *   ↓
 * VALIDATING
 *   ↓
 * VALIDATED
 *   ↓
 * READY
 *   ↓
 * SUBMITTING
 *   ├───────────────┐
 *   ▼               ▼
 * SUBMITTED       FAILED
 *   │               │
 *   ▼               ├── retry
 * ACKNOWLEDGED      │
 *   │               └── exhausted → DEAD_LETTERED
 *   ▼
 * ACCEPTED / REJECTED
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    CAPABILITIES,
    SUBMISSION_STATUS,
    REPORT_TYPES,
} = require('./RegulatoryAdapterInterface');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
    'RegulatorySubmissionService';

const SERVICE_VERSION =
    '1.0.0';

const DEFAULT_MAX_ATTEMPTS =
    5;

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_RETRY_BASE_MS =
    1000;

const DEFAULT_RETRY_MAX_MS =
    15 * 60 * 1000;

const MAX_ATTEMPTS_LIMIT =
    100000;

const MAX_METADATA_KEYS =
    100;

const MAX_REPORT_ID_LENGTH =
    256;

const MAX_TENANT_ID_LENGTH =
    256;

const MAX_REFERENCE_LENGTH =
    256;

const MAX_ERROR_MESSAGE_LENGTH =
    2000;

/**
 * ============================================================================
 * Submission Lifecycle
 * ============================================================================
 */

const SUBMISSION_LIFECYCLE =
    Object.freeze({

        DRAFT:
            'DRAFT',

        VALIDATING:
            'VALIDATING',

        VALIDATED:
            'VALIDATED',

        READY:
            'READY',

        SUBMITTING:
            'SUBMITTING',

        SUBMITTED:
            'SUBMITTED',

        ACKNOWLEDGED:
            'ACKNOWLEDGED',

        ACCEPTED:
            'ACCEPTED',

        REJECTED:
            'REJECTED',

        FAILED:
            'FAILED',

        RETRY_PENDING:
            'RETRY_PENDING',

        DEAD_LETTERED:
            'DEAD_LETTERED',

        AMENDING:
            'AMENDING',

        CANCELLED:
            'CANCELLED',

    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class RegulatorySubmissionServiceError
    extends Error {

    constructor(
        message,
        code =
            'REGULATORY_SUBMISSION_ERROR',
        options = {}
    ) {
        super(
            message
        );

        this.name =
            'RegulatorySubmissionServiceError';

        this.code =
            code;

        this.retryable =
            options.retryable === true;

        this.statusCode =
            Number.isInteger(
                options.statusCode
            )
                ? options.statusCode
                : 500;

        this.tenantId =
            options.tenantId ||
            null;

        this.reportId =
            options.reportId ||
            null;

        this.submissionId =
            options.submissionId ||
            null;

        this.idempotencyKey =
            options.idempotencyKey ||
            null;

        this.adapterName =
            options.adapterName ||
            null;

        this.regulatorReference =
            options.regulatorReference ||
            null;

        this.operation =
            options.operation ||
            null;

        this.cause =
            options.cause;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            RegulatorySubmissionServiceError
        );
    }

    toJSON() {
        return {
            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            retryable:
                this.retryable,

            statusCode:
                this.statusCode,

            tenantId:
                this.tenantId,

            reportId:
                this.reportId,

            submissionId:
                this.submissionId,

            idempotencyKey:
                this.idempotencyKey,

            adapterName:
                this.adapterName,

            regulatorReference:
                this.regulatorReference,

            operation:
                this.operation,

            timestamp:
                this.timestamp,
        };
    }
}

/**
 * ============================================================================
 * Helpers
 * ============================================================================
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
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new RegulatorySubmissionServiceError(
            `${field} is required.`,
            'REGULATORY_SUBMISSION_INVALID_INPUT',
            {
                statusCode:
                    400,
            }
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatorySubmissionServiceError(
            `${field} exceeds maximum length.`,
            'REGULATORY_SUBMISSION_INPUT_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new RegulatorySubmissionServiceError(
            `${field} must be a string.`,
            'REGULATORY_SUBMISSION_INVALID_INPUT',
            {
                statusCode:
                    400,
            }
        );
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatorySubmissionServiceError(
            `${field} exceeds maximum length.`,
            'REGULATORY_SUBMISSION_INPUT_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function normalizePositiveInteger(
    value,
    fallback,
    {
        min = 1,
        max = Number.MAX_SAFE_INTEGER,
    } = {}
) {
    const number =
        Number(value);

    if (
        !Number.isSafeInteger(
            number
        ) ||
        number < min ||
        number > max
    ) {
        return fallback;
    }

    return number;
}

function normalizeDate(
    value,
    field
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(
                value
            );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw new RegulatorySubmissionServiceError(
            `${field} must be a valid date.`,
            'REGULATORY_SUBMISSION_INVALID_DATE',
            {
                statusCode:
                    400,
            }
        );
    }

    return date;
}

function cloneValue(
    value,
    seen = new WeakMap()
) {
    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        seen.has(value)
    ) {
        return seen.get(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        const array = [];

        seen.set(
            value,
            array
        );

        for (
            const item
            of value
        ) {
            array.push(
                cloneValue(
                    item,
                    seen
                )
            );
        }

        return array;
    }

    const result = {};

    seen.set(
        value,
        result
    );

    for (
        const [
            key,
            child
        ] of Object.entries(
            value
        )
    ) {
        result[key] =
            cloneValue(
                child,
                seen
            );
    }

    return result;
}

function deepFreeze(
    value,
    seen = new WeakSet()
) {
    if (
        value === null ||
        typeof value !== 'object' ||
        seen.has(value)
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value;
    }

    seen.add(
        value
    );

    for (
        const child
        of Object.values(
            value
        )
    ) {
        deepFreeze(
            child,
            seen
        );
    }

    return Object.freeze(
        value
    );
}

function stableSerialize(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(
            value
        )
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

function sha256(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            value,
            'utf8'
        )
        .digest('hex');
}

function normalizeReportType(
    type
) {
    const normalized =
        normalizeRequiredString(
            type,
            'report.type',
            64
        ).toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new RegulatorySubmissionServiceError(
            `Unsupported report type: ${normalized}`,
            'REGULATORY_SUBMISSION_UNSUPPORTED_REPORT_TYPE',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class RegulatorySubmissionService {

    constructor(
        options = {}
    ) {

        this.registry =
            options.registry ||
            options.adapterRegistry ||
            null;

        this.calendarService =
            options.calendarService ||
            options.regulatoryCalendarService ||
            null;

        this.repository =
            options.repository ||
            null;

        this.audit =
            options.audit ||
            options.auditService ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.logger =
            options.logger ||
            console;

        this.publisher =
            options.publisher ||
            options.eventBus ||
            null;

        this.maxAttempts =
            normalizePositiveInteger(
                options.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                {
                    max:
                        MAX_ATTEMPTS_LIMIT,
                }
            );

        this.leaseMs =
            normalizePositiveInteger(
                options.leaseMs,
                DEFAULT_LEASE_MS,
                {
                    max:
                        24 *
                        60 *
                        60 *
                        1000,
                }
            );

        this.retryBaseMs =
            normalizePositiveInteger(
                options.retryBaseMs,
                DEFAULT_RETRY_BASE_MS,
                {
                    max:
                        60 *
                        60 *
                        1000,
                }
            );

        this.retryMaxMs =
            normalizePositiveInteger(
                options.retryMaxMs,
                DEFAULT_RETRY_MAX_MS,
                {
                    max:
                        24 *
                        60 *
                        60 *
                        1000,
                }
            );

        this.requireRepository =
            options.requireRepository !==
                undefined
                ? Boolean(
                    options.requireRepository
                )
                : true;
    }

    /**
     * =========================================================================
     * Submit Report
     * =========================================================================
     */

    async submitReport(
        report,
        context = {}
    ) {

        const normalized =
            this.normalizeSubmissionContext(
                report,
                context
            );

        const adapter =
            this.resolveAdapter(
                normalized
            );

        this.assertTenantContext(
            normalized
        );

        this.assertAdapter(
            adapter
        );

        /**
         * ---------------------------------------------------------------------
         * Existing durable submission
         * ---------------------------------------------------------------------
         */

        const existing =
            await this.findExistingSubmission(
                normalized
            );

        if (
            existing
        ) {
            const existingResult =
                this.resolveExistingSubmission(
                    existing,
                    normalized
                );

            if (
                existingResult
            ) {
                return existingResult;
            }

            /**
             * Existing FAILED / RETRY_PENDING may be reclaimable.
             */
        }

        /**
         * ---------------------------------------------------------------------
         * Filing calendar
         * ---------------------------------------------------------------------
         */

        await this.assertSubmissionWindow(
            report,
            normalized
        );

        /**
         * ---------------------------------------------------------------------
         * VALIDATING
         * ---------------------------------------------------------------------
         */

        await this.persistLifecycle(
            normalized,
            SUBMISSION_LIFECYCLE.VALIDATING,
            {
                stage:
                    'VALIDATION',
            }
        );

        const validation =
            await this.validateReport(
                adapter,
                report,
                normalized
            );

        if (
            validation.valid !== true
        ) {

            await this.persistLifecycle(
                normalized,
                SUBMISSION_LIFECYCLE.FAILED,
                {
                    stage:
                        'VALIDATION',

                    error:
                        {
                            code:
                                'REGULATORY_SUBMISSION_VALIDATION_FAILED',

                            message:
                                'Regulatory report validation failed.',

                            errors:
                                validation.errors ||
                                [],

                            warnings:
                                validation.warnings ||
                                [],

                            retryable:
                                false,
                        },
                }
            );

            throw this.createError(
                'REGULATORY_SUBMISSION_VALIDATION_FAILED',
                'Regulatory report validation failed.',
                normalized,
                {
                    statusCode:
                        400,

                    retryable:
                        false,
                }
            );
        }

        await this.persistLifecycle(
            normalized,
            SUBMISSION_LIFECYCLE.VALIDATED,
            {
                validation,
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Adapter transformation
         * ---------------------------------------------------------------------
         */

        const transformed =
            await this.transformReport(
                adapter,
                report,
                normalized
            );

        /**
         * ---------------------------------------------------------------------
         * Deterministic idempotency key
         * ---------------------------------------------------------------------
         */

        const idempotencyKey =
            normalized.idempotencyKey ||
            adapter.createIdempotencyKey(
                report,
                normalized
            );

        normalized.idempotencyKey =
            idempotencyKey;

        /**
         * ---------------------------------------------------------------------
         * Durable claim
         * ---------------------------------------------------------------------
         */

        const ownership =
            await this.claimSubmission(
                normalized,
                {
                    idempotencyKey,

                    report,

                    transformed,
                }
            );

        if (
            ownership?.duplicate ||
            ownership?.alreadyCompleted
        ) {
            return this.resolveExistingSubmission(
                ownership.record ||
                    ownership,
                normalized
            );
        }

        const claimToken =
            ownership?.claimToken ||
            ownership?.token ||
            ownership?.leaseToken ||
            null;

        const ownedContext = {
            ...normalized,

            idempotencyKey,

            claimToken,

            submissionId:
                ownership?.submissionId ||
                ownership?.record?.submissionId ||
                normalized.submissionId ||
                null,
        };

        /**
         * ---------------------------------------------------------------------
         * READY
         * ---------------------------------------------------------------------
         */

        await this.persistLifecycle(
            ownedContext,
            SUBMISSION_LIFECYCLE.READY,
            {
                transformedFingerprint:
                    sha256(
                        stableSerialize(
                            transformed
                        )
                    ),
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Adapter beforeSubmission
         * ---------------------------------------------------------------------
         */

        let prepared;

        try {

            if (
                typeof adapter.beforeSubmission ===
                    'function'
            ) {
                prepared =
                    await adapter.beforeSubmission(
                        report,
                        ownedContext
                    );
            } else {
                prepared = {
                    report,
                    context:
                        ownedContext,
                    idempotencyKey,
                };
            }

        } catch (
            error
        ) {

            return this.handleFailure(
                error,
                {
                    ...ownedContext,

                    report,
                },

                {
                    stage:
                        'BEFORE_SUBMISSION',
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * SUBMITTING
         * ---------------------------------------------------------------------
         */

        await this.persistLifecycle(
            ownedContext,
            SUBMISSION_LIFECYCLE.SUBMITTING,
            {
                startedAt:
                    new Date(),
            }
        );

        await this.auditEvent(
            'REGULATORY_SUBMISSION_STARTED',
            {
                context:
                    this.safeContext(
                        ownedContext
                    ),

                reportId:
                    normalized.reportId,

                idempotencyKey:
                    idempotencyKey,
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Regulator submission
         * ---------------------------------------------------------------------
         */

        let submissionResponse;

        try {

            submissionResponse =
                await adapter.submitReport(
                    transformed,
                    {
                        ...ownedContext,

                        ...(
                            prepared?.context ||
                            {}
                        ),

                        idempotencyKey,
                    }
                );

        } catch (
            error
        ) {

            return this.handleFailure(
                error,
                {
                    ...ownedContext,

                    report,
                },

                {
                    stage:
                        'SUBMIT',
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Normalize submission response
         * ---------------------------------------------------------------------
         */

        const normalizedSubmission =
            adapter.normalizeSubmissionResponse
                ? adapter.normalizeSubmissionResponse(
                    submissionResponse
                )
                : submissionResponse;

        /**
         * ---------------------------------------------------------------------
         * SUBMITTED
         * ---------------------------------------------------------------------
         */

        await this.persistLifecycle(
            ownedContext,
            SUBMISSION_LIFECYCLE.SUBMITTED,
            {
                submission:
                    normalizedSubmission,

                regulatorReference:
                    normalizedSubmission?.regulatorReference ||
                    null,

                submissionReference:
                    normalizedSubmission?.reference ||
                    null,

                submittedAt:
                    normalizedSubmission?.submittedAt ||
                    new Date(),
            }
        );

        /**
         * ---------------------------------------------------------------------
         * ACKNOWLEDGEMENT
         * ---------------------------------------------------------------------
         *
         * Some regulators acknowledge synchronously.
         * Others return an accepted submission reference and require polling.
         * ---------------------------------------------------------------------
         */

        let finalResult;

        if (
            normalizedSubmission?.raw &&
            this.shouldParseAcknowledgement(
                normalizedSubmission
            )
        ) {

            const acknowledgement =
                await this.parseAcknowledgement(
                    adapter,
                    normalizedSubmission.raw,
                    ownedContext
                );

            finalResult =
                await this.finalizeAcknowledgement(
                    adapter,
                    report,
                    acknowledgement,
                    ownedContext
                );

        } else {

            finalResult =
                this.buildSubmittedResult(
                    normalizedSubmission,
                    ownedContext
                );
        }

        /**
         * ---------------------------------------------------------------------
         * Adapter afterSubmission
         * ---------------------------------------------------------------------
         */

        try {

            if (
                typeof adapter.afterSubmission ===
                    'function'
            ) {

                await adapter.afterSubmission(
                    report,
                    finalResult,
                    ownedContext
                );
            }

        } catch (
            error
        ) {

            /**
             * The regulator submission has already happened.
             *
             * Do NOT report the financial/regulatory submission as unsubmitted
             * merely because a local post-processing hook failed.
             *
             * Persist the operational failure separately.
             */
            await this.auditEvent(
                'REGULATORY_SUBMISSION_AFTER_HOOK_FAILED',
                {
                    context:
                        this.safeContext(
                            ownedContext
                        ),

                    reportId:
                        normalized.reportId,

                    error:
                        this.safeError(
                            error
                        ),
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Complete durable ownership
         * ---------------------------------------------------------------------
         */

        await this.completeSubmission(
            ownedContext,
            finalResult
        );

        /**
         * ---------------------------------------------------------------------
         * Audit / events
         * ---------------------------------------------------------------------
         */

        await this.auditEvent(
            'REGULATORY_SUBMISSION_COMPLETED',
            {
                context:
                    this.safeContext(
                        ownedContext
                    ),

                reportId:
                    normalized.reportId,

                result:
                    this.safeResult(
                        finalResult
                    ),
            }
        );

        await this.publishEvent(
            'regulatory.submission.completed',
            {
                tenantId:
                    ownedContext.tenantId,

                reportId:
                    ownedContext.reportId,

                submissionId:
                    ownedContext.submissionId,

                idempotencyKey,
                status:
                    finalResult.status,
            }
        );

        return finalResult;
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    async validateReport(
        adapter,
        report,
        context
    ) {

        this.assertAdapter(
            adapter
        );

        if (
            typeof adapter.validateReport !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_VALIDATION_UNAVAILABLE',
                'Regulatory adapter validation is unavailable.',
                context,
                {
                    retryable:
                        false,
                }
            );
        }

        if (
            typeof adapter.beforeValidation ===
                'function'
        ) {
            await adapter.beforeValidation(
                report,
                context
            );
        }

        const result =
            await adapter.validateReport(
                report,
                context
            );

        const normalized = {
            valid:
                result?.valid === true,

            errors:
                Array.isArray(
                    result?.errors
                )
                    ? result.errors
                    : [],

            warnings:
                Array.isArray(
                    result?.warnings
                )
                    ? result.warnings
                    : [],
        };

        if (
            typeof adapter.afterValidation ===
                'function'
        ) {
            await adapter.afterValidation(
                report,
                normalized,
                context
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Transformation
     * =========================================================================
     */

    async transformReport(
        adapter,
        report,
        context
    ) {

        this.assertAdapter(
            adapter
        );

        if (
            typeof adapter.transformReport !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_TRANSFORMATION_UNAVAILABLE',
                'Regulatory adapter report transformation is unavailable.',
                context,
                {
                    retryable:
                        false,
                }
            );
        }

        return adapter.transformReport(
            report,
            context
        );
    }

    /**
     * =========================================================================
     * Acknowledgement
     * =========================================================================
     */

    async parseAcknowledgement(
        adapter,
        response,
        context
    ) {

        if (
            typeof adapter.parseAcknowledgement !==
                'function'
        ) {
            return {
                accepted:
                    false,

                status:
                    SUBMISSION_STATUS.SUBMITTED,

                reference:
                    null,

                regulatorReference:
                    null,

                errors:
                    [],

                warnings:
                    [],
            };
        }

        const result =
            await adapter.parseAcknowledgement(
                response,
                context
            );

        return adapter.normalizeAcknowledgement
            ? adapter.normalizeAcknowledgement(
                result
            )
            : result;
    }

    /**
     * =========================================================================
     * Finalize Acknowledgement
     * =========================================================================
     */

    async finalizeAcknowledgement(
        adapter,
        report,
        acknowledgement,
        context
    ) {

        const normalized =
            acknowledgement || {};

        let status =
            normalized.status ||
            SUBMISSION_STATUS.ACKNOWLEDGED;

        if (
            normalized.accepted === true
        ) {
            status =
                SUBMISSION_STATUS.ACCEPTED;
        } else if (
            normalized.accepted === false &&
            (
                Array.isArray(
                    normalized.errors
                ) &&
                normalized.errors.length > 0
            )
        ) {
            status =
                SUBMISSION_STATUS.REJECTED;
        }

        const lifecycle =
            status ===
                SUBMISSION_STATUS.ACCEPTED
                ? SUBMISSION_LIFECYCLE.ACCEPTED
                : status ===
                    SUBMISSION_STATUS.REJECTED
                    ? SUBMISSION_LIFECYCLE.REJECTED
                    : SUBMISSION_LIFECYCLE.ACKNOWLEDGED;

        await this.persistLifecycle(
            context,
            lifecycle,
            {
                acknowledgement:
                    normalized,

                regulatorReference:
                    normalized.regulatorReference ||
                    null,

                acknowledgedAt:
                    normalized.acknowledgedAt ||
                    new Date(),
            }
        );

        return {
            success:
                status ===
                SUBMISSION_STATUS.ACCEPTED,

            status,

            submissionId:
                context.submissionId ||
                null,

            reportId:
                context.reportId,

            tenantId:
                context.tenantId,

            idempotencyKey:
                context.idempotencyKey,

            reference:
                normalized.reference ||
                null,

            regulatorReference:
                normalized.regulatorReference ||
                null,

            errors:
                Array.isArray(
                    normalized.errors
                )
                    ? normalized.errors
                    : [],

            warnings:
                Array.isArray(
                    normalized.warnings
                )
                    ? normalized.warnings
                    : [],

            acknowledgedAt:
                normalized.acknowledgedAt ||
                new Date(),
        };
    }

    /**
     * =========================================================================
     * Status Query
     * =========================================================================
     */

    async getSubmissionStatus(
        submission,
        context = {}
    ) {

        if (
            !submission
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_REQUIRED',
                'Submission is required.',
                context,
                {
                    statusCode:
                        400,
                }
            );
        }

        const normalized =
            this.normalizeSubmissionContext(
                submission.report ||
                    {
                        id:
                            submission.reportId,

                        type:
                            submission.reportType,

                        tenantId:
                            submission.tenantId,
                    },
                {
                    ...context,

                    tenantId:
                        context.tenantId ||
                        submission.tenantId,

                    reportId:
                        context.reportId ||
                        submission.reportId,

                    submissionId:
                        context.submissionId ||
                        submission.submissionId,

                    regulatorReference:
                        context.regulatorReference ||
                        submission.regulatorReference,
                }
            );

        const adapter =
            this.resolveAdapter(
                normalized
            );

        this.assertTenantContext(
            normalized
        );

        this.assertAdapter(
            adapter
        );

        if (
            !adapter.supports?.(
                CAPABILITIES.STATUS_QUERY
            )
        ) {
            throw this.createError(
                'REGULATORY_STATUS_QUERY_UNSUPPORTED',
                'Regulatory adapter does not support submission status queries.',
                normalized,
                {
                    retryable:
                        false,
                }
            );
        }

        const reference =
            normalized.regulatorReference ||
            submission.regulatorReference ||
            submission.reference;

        if (
            !reference
        ) {
            throw this.createError(
                'REGULATORY_STATUS_REFERENCE_REQUIRED',
                'A regulator submission reference is required.',
                normalized,
                {
                    statusCode:
                        400,
                }
            );
        }

        const response =
            await adapter.getSubmissionStatus(
                reference,
                normalized
            );

        const normalizedResponse =
            adapter.normalizeSubmissionResponse
                ? adapter.normalizeSubmissionResponse(
                    response
                )
                : response;

        await this.persistLifecycle(
            normalized,
            this.mapStatusToLifecycle(
                normalizedResponse.status
            ),
            {
                regulatorStatus:
                    normalizedResponse.status,

                regulatorReference:
                    normalizedResponse.regulatorReference ||
                    reference,

                statusCheckedAt:
                    new Date(),
            }
        );

        return normalizedResponse;
    }

    /**
     * =========================================================================
     * Amend Report
     * =========================================================================
     */

    async amendReport(
        report,
        context = {}
    ) {

        const normalized =
            this.normalizeSubmissionContext(
                report,
                context
            );

        const adapter =
            this.resolveAdapter(
                normalized
            );

        this.assertTenantContext(
            normalized
        );

        this.assertAdapter(
            adapter
        );

        if (
            !adapter.supports?.(
                CAPABILITIES.AMENDMENT
            )
        ) {
            throw this.createError(
                'REGULATORY_AMENDMENT_UNSUPPORTED',
                'Regulatory adapter does not support amendments.',
                normalized,
                {
                    retryable:
                        false,
                }
            );
        }

        await this.persistLifecycle(
            normalized,
            SUBMISSION_LIFECYCLE.AMENDING
        );

        try {

            const result =
                await adapter.amendReport(
                    report,
                    normalized
                );

            const normalizedResult =
                adapter.normalizeSubmissionResponse
                    ? adapter.normalizeSubmissionResponse(
                        result
                    )
                    : result;

            await this.persistLifecycle(
                normalized,
                this.mapStatusToLifecycle(
                    normalizedResult.status
                ),
                {
                    amendment:
                        normalizedResult,
                }
            );

            await this.auditEvent(
                'REGULATORY_SUBMISSION_AMENDED',
                {
                    context:
                        this.safeContext(
                            normalized
                        ),

                    reportId:
                        normalized.reportId,
                }
            );

            return normalizedResult;

        } catch (
            error
        ) {

            return this.handleFailure(
                error,
                normalized,
                {
                    stage:
                        'AMEND',
                }
            );
        }
    }

    /**
     * =========================================================================
     * Cancel Report
     * =========================================================================
     */

    async cancelReport(
        report,
        context = {}
    ) {

        const normalized =
            this.normalizeSubmissionContext(
                report,
                context
            );

        const adapter =
            this.resolveAdapter(
                normalized
            );

        this.assertTenantContext(
            normalized
        );

        this.assertAdapter(
            adapter
        );

        if (
            !adapter.supports?.(
                CAPABILITIES.CANCELLATION
            )
        ) {
            throw this.createError(
                'REGULATORY_CANCELLATION_UNSUPPORTED',
                'Regulatory adapter does not support cancellation.',
                normalized,
                {
                    retryable:
                        false,
                }
            );
        }

        try {

            const result =
                await adapter.cancelReport(
                    report,
                    normalized
                );

            await this.persistLifecycle(
                normalized,
                SUBMISSION_LIFECYCLE.CANCELLED,
                {
                    cancellation:
                        cloneValue(
                            result
                        ),

                    cancelledAt:
                        new Date(),
                }
            );

            await this.auditEvent(
                'REGULATORY_SUBMISSION_CANCELLED',
                {
                    context:
                        this.safeContext(
                            normalized
                        ),

                    reportId:
                        normalized.reportId,
                }
            );

            return result;

        } catch (
            error
        ) {

            return this.handleFailure(
                error,
                normalized,
                {
                    stage:
                        'CANCEL',
                }
            );
        }
    }

    /**
     * =========================================================================
     * Resolve Adapter
     * =========================================================================
     */

    resolveAdapter(
        context
    ) {

        if (
            context.adapter
        ) {
            return context.adapter;
        }

        if (
            !this.registry
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_REGISTRY_REQUIRED',
                'Regulatory adapter registry is required.',
                context,
                {
                    retryable:
                        false,
                }
            );
        }

        if (
            typeof this.registry.resolveForReport ===
                'function' &&
            context.report
        ) {
            return this.registry.resolveForReport(
                context.report,
                context
            );
        }

        if (
            typeof this.registry.resolve !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_REGISTRY_INVALID',
                'Regulatory adapter registry does not provide resolve().',
                context,
                {
                    retryable:
                        false,
                }
            );
        }

        return this.registry.resolve({
            tenantId:
                context.tenantId,

            adapterName:
                context.adapterName,

            version:
                context.adapterVersion ||
                context.version,

            countryCode:
                context.countryCode,

            jurisdiction:
                context.jurisdiction,

            regulatorCode:
                context.regulatorCode,

            reportType:
                context.reportType,

            capability:
                context.capability,
        });
    }

    /**
     * =========================================================================
     * Calendar Window
     * =========================================================================
     */

    async assertSubmissionWindow(
        report,
        context
    ) {

        if (
            !this.calendarService
        ) {
            return true;
        }

        if (
            typeof this.calendarService.getFilingWindow !==
                'function'
        ) {
            return true;
        }

        const window =
            await this.calendarService.getFilingWindow(
                report,
                context
            );

        if (
            !window
        ) {
            return true;
        }

        if (
            window.status ===
                'NOT_YET_OPEN'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_WINDOW_NOT_OPEN',
                'The regulatory filing window is not yet open.',
                context,
                {
                    statusCode:
                        409,

                    retryable:
                        false,
                }
            );
        }

        if (
            window.status ===
                'CLOSED'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_WINDOW_CLOSED',
                'The regulatory filing window is closed.',
                context,
                {
                    statusCode:
                        409,

                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Normalize Submission Context
     * =========================================================================
     */

    normalizeSubmissionContext(
        report,
        context = {}
    ) {

        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_REPORT_REQUIRED',
                'Regulatory report is required.',
                context,
                {
                    statusCode:
                        400,
                }
            );
        }

        const tenantId =
            normalizeRequiredString(
                context.tenantId ||
                    report.tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        const reportId =
            normalizeRequiredString(
                context.reportId ||
                    report.id ||
                    report.reportId,
                'reportId',
                MAX_REPORT_ID_LENGTH
            );

        const reportType =
            normalizeReportType(
                context.reportType ||
                    report.type
            );

        const submissionId =
            normalizeOptionalString(
                context.submissionId ||
                    report.submissionId,
                'submissionId',
                MAX_REPORT_ID_LENGTH
            );

        const adapterName =
            normalizeOptionalString(
                context.adapterName ||
                    report.adapterName,
                'adapterName',
                128
            );

        const countryCode =
            normalizeOptionalString(
                context.countryCode ||
                    report.countryCode,
                'countryCode',
                8
            )?.toUpperCase() ||
            null;

        const jurisdiction =
            normalizeOptionalString(
                context.jurisdiction ||
                    report.jurisdiction,
                'jurisdiction',
                128
            );

        const regulatorCode =
            normalizeOptionalString(
                context.regulatorCode ||
                    report.regulatorCode,
                'regulatorCode',
                128
            )?.toUpperCase() ||
            null;

        return {
            ...context,

            report,

            tenantId,

            reportId,

            reportType,

            submissionId,

            adapterName,

            countryCode,

            jurisdiction,

            regulatorCode,

            asOf:
                context.asOf
                    ? normalizeDate(
                        context.asOf,
                        'asOf'
                    )
                    : new Date(),

            requestId:
                context.requestId ||
                null,

            correlationId:
                context.correlationId ||
                context.requestId ||
                null,

            attempt:
                normalizePositiveInteger(
                    context.attempt,
                    1,
                    {
                        max:
                            MAX_ATTEMPTS_LIMIT,
                    }
                ),

            maxAttempts:
                normalizePositiveInteger(
                    context.maxAttempts,
                    this.maxAttempts,
                    {
                        max:
                            MAX_ATTEMPTS_LIMIT,
                    }
                ),

            leaseMs:
                normalizePositiveInteger(
                    context.leaseMs,
                    this.leaseMs
                ),
        };
    }

    /**
     * =========================================================================
     * Tenant Context
     * =========================================================================
     */

    assertTenantContext(
        context
    ) {

        if (
            !context.tenantId
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_TENANT_REQUIRED',
                'tenantId is required.',
                context,
                {
                    statusCode:
                        403,

                    retryable:
                        false,
                }
            );
        }

        if (
            context.report?.tenantId &&
            String(
                context.report.tenantId
            ) !==
                String(
                    context.tenantId
                )
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_TENANT_MISMATCH',
                'Report tenant does not match submission tenant context.',
                context,
                {
                    statusCode:
                        403,

                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Adapter Contract
     * =========================================================================
     */

    assertAdapter(
        adapter
    ) {

        if (
            !adapter ||
            typeof adapter !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_ADAPTER_REQUIRED',
                'Regulatory adapter is required.',
                {},
                {
                    retryable:
                        false,
                }
            );
        }

        const requiredMethods = [
            'validateReport',
            'transformReport',
            'submitReport',
            'createIdempotencyKey',
        ];

        const missing =
            requiredMethods.filter(
                method =>
                    typeof adapter[method] !==
                    'function'
            );

        if (
            missing.length > 0
        ) {
            throw this.createError(
                'REGULATORY_SUBMISSION_ADAPTER_INVALID',
                `Regulatory adapter is missing required methods: ${missing.join(', ')}`,
                {},
                {
                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Durable Repository: Find
     * =========================================================================
     */

    async findExistingSubmission(
        context
    ) {

        if (
            !this.repository
        ) {
            if (
                this.requireRepository
            ) {
                throw this.createError(
                    'REGULATORY_SUBMISSION_REPOSITORY_REQUIRED',
                    'Regulatory submission repository is required.',
                    context,
                    {
                        retryable:
                            true,
                    }
                );
            }

            return null;
        }

        if (
            typeof this.repository.findByIdempotencyKey ===
                'function' &&
            context.idempotencyKey
        ) {
            return this.repository.findByIdempotencyKey(
                context.idempotencyKey,
                {
                    tenantId:
                        context.tenantId,
                }
            );
        }

        if (
            typeof this.repository.findOne ===
                'function' &&
            context.idempotencyKey
        ) {
            return this.repository.findOne({
                tenantId:
                    context.tenantId,

                idempotencyKey:
                    context.idempotencyKey,
            });
        }

        return null;
    }

    /**
     * =========================================================================
     * Durable Claim
     * =========================================================================
     *
     * Preferred repository contract:
     *
     * claim()
     *
     * Compatibility contracts:
     * create()
     *
     * The repository is responsible for enforcing a unique tenant +
     * idempotency key constraint.
     */

    async claimSubmission(
        context,
        {
            idempotencyKey,
            report,
            transformed,
        }
    ) {

        if (
            !this.repository
        ) {
            if (
                this.requireRepository
            ) {
                throw this.createError(
                    'REGULATORY_SUBMISSION_REPOSITORY_REQUIRED',
                    'Durable regulatory submission persistence is required.',
                    context,
                    {
                        retryable:
                            true,
                    }
                );
            }

            return {
                duplicate:
                    false,

                reserved:
                    false,

                claimToken:
                    null,
            };
        }

        const claimToken =
            crypto
                .randomBytes(
                    32
                )
                .toString('hex');

        const payload = {
            tenantId:
                context.tenantId,

            reportId:
                context.reportId,

            reportType:
                context.reportType,

            adapterName:
                context.adapterName,

            countryCode:
                context.countryCode,

            jurisdiction:
                context.jurisdiction,

            regulatorCode:
                context.regulatorCode,

            idempotencyKey,

            claimToken,

            attempt:
                context.attempt,

            leaseExpiresAt:
                new Date(
                    Date.now() +
                    context.leaseMs
                ),

            state:
                SUBMISSION_LIFECYCLE.DRAFT,

            status:
                SUBMISSION_STATUS.DRAFT,

            reportFingerprint:
                this.createReportFingerprint(
                    report
                ),

            transformedFingerprint:
                sha256(
                    stableSerialize(
                        transformed
                    )
                ),

            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            claimedAt:
                new Date(),
        };

        if (
            typeof this.repository.claim ===
                'function'
        ) {

            try {

                return await this.repository.claim(
                    payload
                );

            } catch (
                error
            ) {

                if (
                    this.isDuplicateError(
                        error
                    )
                ) {
                    const existing =
                        await this.findExistingSubmission(
                            context
                        );

                    return {
                        duplicate:
                            true,

                        record:
                            existing,

                        claimToken:
                            null,
                    };
                }

                throw this.wrapRepositoryError(
                    error,
                    'claim',
                    context
                );
            }
        }

        if (
            typeof this.repository.create ===
                'function'
        ) {

            try {

                const created =
                    await this.repository.create(
                        payload
                    );

                return {
                    duplicate:
                        false,

                    reserved:
                        true,

                    claimToken,

                    submissionId:
                        created?.submissionId ||
                        created?.id ||
                        null,

                    record:
                        created,
                };

            } catch (
                error
            ) {

                if (
                    this.isDuplicateError(
                        error
                    )
                ) {
                    const existing =
                        await this.findExistingSubmission(
                            context
                        );

                    return {
                        duplicate:
                            true,

                        record:
                            existing,

                        claimToken:
                            null,
                    };
                }

                throw this.wrapRepositoryError(
                    error,
                    'create',
                    context
                );
            }
        }

        throw this.createError(
            'REGULATORY_SUBMISSION_REPOSITORY_CLAIM_UNAVAILABLE',
            'Regulatory submission repository does not provide claim() or create().',
            context,
            {
                retryable:
                    false,
            }
        );
    }

    /**
     * =========================================================================
     * Completion
     * =========================================================================
     */

    async completeSubmission(
        context,
        result
    ) {

        if (
            !this.repository
        ) {
            return;
        }

        const payload = {
            tenantId:
                context.tenantId,

            submissionId:
                context.submissionId,

            reportId:
                context.reportId,

            idempotencyKey:
                context.idempotencyKey,

            claimToken:
                context.claimToken,

            state:
                this.mapStatusToLifecycle(
                    result.status
                ),

            status:
                result.status,

            completedAt:
                new Date(),

            result:
                cloneValue(
                    result
                ),
        };

        if (
            typeof this.repository.complete ===
                'function'
        ) {

            try {

                return await this.repository.complete(
                    payload
                );

            } catch (
                error
            ) {

                throw this.wrapRepositoryError(
                    error,
                    'complete',
                    context
                );
            }
        }

        if (
            typeof this.repository.update ===
                'function'
        ) {

            return this.repository.update(
                context.submissionId,
                payload
            );
        }

        if (
            typeof this.repository.findOneAndUpdate ===
                'function'
        ) {

            return this.repository.findOneAndUpdate(
                {
                    tenantId:
                        context.tenantId,

                    idempotencyKey:
                        context.idempotencyKey,
                },
                {
                    $set:
                        payload,
                }
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Lifecycle Persistence
     * =========================================================================
     */

    async persistLifecycle(
        context,
        state,
        data = {}
    ) {

        if (
            !this.repository
        ) {
            if (
                this.requireRepository
            ) {
                throw this.createError(
                    'REGULATORY_SUBMISSION_REPOSITORY_REQUIRED',
                    'Regulatory submission repository is required.',
                    context,
                    {
                        retryable:
                            true,
                    }
                );
            }

            return null;
        }

        const payload = {
            tenantId:
                context.tenantId,

            reportId:
                context.reportId,

            submissionId:
                context.submissionId,

            idempotencyKey:
                context.idempotencyKey,

            claimToken:
                context.claimToken,

            state,

            updatedAt:
                new Date(),

            ...cloneValue(
                data
            ),
        };

        if (
            typeof this.repository.transitionState ===
                'function'
        ) {

            return this.repository.transitionState(
                payload
            );
        }

        if (
            typeof this.repository.updateLifecycle ===
                'function'
        ) {

            return this.repository.updateLifecycle(
                payload
            );
        }

        if (
            typeof this.repository.findOneAndUpdate ===
                'function'
        ) {

            const filter = {
                tenantId:
                    context.tenantId,

                ...(context.submissionId
                    ? {
                        submissionId:
                            context.submissionId,
                    }
                    : {
                        idempotencyKey:
                            context.idempotencyKey,
                    }),
            };

            return this.repository.findOneAndUpdate(
                filter,
                {
                    $set:
                        payload,
                }
            );
        }

        if (
            typeof this.repository.update ===
                'function' &&
            context.submissionId
        ) {

            return this.repository.update(
                context.submissionId,
                payload
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Existing Submission Resolution
     * =========================================================================
     */

    resolveExistingSubmission(
        existing,
        context
    ) {

        if (
            !existing
        ) {
            return null;
        }

        const status =
            String(
                existing.status ||
                ''
            )
                .trim()
                .toUpperCase();

        const state =
            String(
                existing.state ||
                ''
            )
                .trim()
                .toUpperCase();

        /**
         * Terminal accepted submission.
         */
        if (
            status ===
                SUBMISSION_STATUS.ACCEPTED ||
            state ===
                SUBMISSION_LIFECYCLE.ACCEPTED
        ) {
            return {
                success:
                    true,

                duplicate:
                    true,

                alreadyCompleted:
                    true,

                status:
                    SUBMISSION_STATUS.ACCEPTED,

                submissionId:
                    existing.submissionId ||
                    existing.id ||
                    context.submissionId ||
                    null,

                reportId:
                    context.reportId,

                tenantId:
                    context.tenantId,

                idempotencyKey:
                    context.idempotencyKey,

                reference:
                    existing.reference ||
                    null,

                regulatorReference:
                    existing.regulatorReference ||
                    null,
            };
        }

        /**
         * Submitted but awaiting regulator acknowledgement.
         */
        if (
            status ===
                SUBMISSION_STATUS.SUBMITTED ||
            state ===
                SUBMISSION_LIFECYCLE.SUBMITTED ||
            state ===
                SUBMISSION_LIFECYCLE.ACKNOWLEDGED
        ) {
            return {
                success:
                    true,

                duplicate:
                    true,

                alreadySubmitted:
                    true,

                status:
                    status ||
                    SUBMISSION_STATUS.SUBMITTED,

                submissionId:
                    existing.submissionId ||
                    existing.id ||
                    null,

                reportId:
                    context.reportId,

                tenantId:
                    context.tenantId,

                idempotencyKey:
                    context.idempotencyKey,

                reference:
                    existing.reference ||
                    null,

                regulatorReference:
                    existing.regulatorReference ||
                    null,

                pendingAcknowledgement:
                    true,
            };
        }

        /**
         * Active submission should not be duplicated.
         */
        if (
            state ===
                SUBMISSION_LIFECYCLE.SUBMITTING ||
            state ===
                SUBMISSION_LIFECYCLE.READY ||
            state ===
                SUBMISSION_LIFECYCLE.VALIDATING
        ) {

            throw this.createError(
                'REGULATORY_SUBMISSION_ALREADY_PROCESSING',
                'Regulatory submission is already being processed.',
                context,
                {
                    statusCode:
                        409,

                    retryable:
                        true,

                    submissionId:
                        existing.submissionId ||
                        existing.id ||
                        null,
                }
            );
        }

        /**
         * Failed/retryable records may be reclaimed by claim().
         */
        return null;
    }

    /**
     * =========================================================================
     * Retry / Failure Handling
     * =========================================================================
     */

    async handleFailure(
        error,
        context,
        {
            stage =
                'SUBMISSION',
        } = {}
    ) {

        const normalized =
            this.normalizeFailure(
                error,
                context,
                stage
            );

        const attempt =
            context.attempt || 1;

        const maxAttempts =
            context.maxAttempts ||
            this.maxAttempts;

        const exhausted =
            attempt >=
            maxAttempts;

        const terminal =
            !normalized.retryable ||
            exhausted;

        if (
            terminal
        ) {

            await this.persistLifecycle(
                context,
                SUBMISSION_LIFECYCLE.DEAD_LETTERED,
                {
                    failedAt:
                        new Date(),

                    deadLetteredAt:
                        new Date(),

                    attempt,

                    maxAttempts,

                    error:
                        normalized,
                }
            );

            await this.auditEvent(
                'REGULATORY_SUBMISSION_DEAD_LETTERED',
                {
                    context:
                        this.safeContext(
                            context
                        ),

                    error:
                        this.safeError(
                            normalized
                        ),

                    attempt,

                    maxAttempts,
                }
            );

            await this.publishEvent(
                'regulatory.submission.dead_lettered',
                {
                    tenantId:
                        context.tenantId,

                    reportId:
                        context.reportId,

                    submissionId:
                        context.submissionId,

                    idempotencyKey:
                        context.idempotencyKey,

                    errorCode:
                        normalized.code,
                }
            );

            throw normalized;
        }

        const retryDelayMs =
            this.calculateRetryDelay(
                attempt
            );

        await this.persistLifecycle(
            context,
            SUBMISSION_LIFECYCLE.RETRY_PENDING,
            {
                failedAt:
                    new Date(),

                attempt,

                maxAttempts,

                retryDelayMs,

                nextRetryAt:
                    new Date(
                        Date.now() +
                        retryDelayMs
                    ),

                error:
                    normalized,
            }
        );

        await this.auditEvent(
            'REGULATORY_SUBMISSION_RETRY_PENDING',
            {
                context:
                    this.safeContext(
                        context
                    ),

                error:
                    this.safeError(
                        normalized
                    ),

                attempt,

                maxAttempts,

                retryDelayMs,
            }
        );

        throw normalized;
    }

    /**
     * =========================================================================
     * Failure Normalization
     * =========================================================================
     */

    normalizeFailure(
        error,
        context,
        stage
    ) {

        if (
            error instanceof
            RegulatorySubmissionServiceError
        ) {
            error.stage =
                stage;

            return error;
        }

        const adapter =
            context.adapter;

        let normalized;

        if (
            adapter &&
            typeof adapter.normalizeError ===
                'function'
        ) {
            normalized =
                adapter.normalizeError(
                    error,
                    {
                        ...context,

                        operation:
                            stage,
                    }
                );
        }

        const result =
            this.createError(
                normalized?.code ||
                    error?.code ||
                    'REGULATORY_SUBMISSION_FAILED',

                normalized?.message ||
                    error?.message ||
                    'Regulatory submission failed.',

                context,

                {
                    statusCode:
                        error?.statusCode ||
                        502,

                    retryable:
                        error?.retryable !==
                            undefined
                            ? error.retryable ===
                                true
                            : (
                                normalized?.retryable ===
                                true
                            ),

                    cause:
                        error,

                    operation:
                        stage,
                }
            );

        result.stage =
            stage;

        return result;
    }

    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    calculateRetryDelay(
        attempt
    ) {

        const exponent =
            Math.max(
                0,
                attempt - 1
            );

        const delay =
            this.retryBaseMs *
            Math.pow(
                2,
                exponent
            );

        const capped =
            Math.min(
                delay,
                this.retryMaxMs
            );

        /**
         * Small deterministic jitter prevents synchronized retry storms while
         * remaining test-friendly.
         */
        const jitterSeed =
            sha256(
                String(
                    attempt
                )
            ).slice(
                0,
                8
            );

        const jitter =
            parseInt(
                jitterSeed,
                16
            ) %
            Math.max(
                100,
                Math.floor(
                    capped * 0.1
                )
            );

        return Math.min(
            capped + jitter,
            this.retryMaxMs
        );
    }

    /**
     * =========================================================================
     * Status Mapping
     * =========================================================================
     */

    mapStatusToLifecycle(
        status
    ) {

        switch (
            String(
                status ||
                ''
            )
                .trim()
                .toUpperCase()
        ) {

            case SUBMISSION_STATUS.DRAFT:
                return SUBMISSION_LIFECYCLE.DRAFT;

            case SUBMISSION_STATUS.VALIDATED:
                return SUBMISSION_LIFECYCLE.VALIDATED;

            case SUBMISSION_STATUS.READY:
                return SUBMISSION_LIFECYCLE.READY;

            case SUBMISSION_STATUS.SUBMITTED:
                return SUBMISSION_LIFECYCLE.SUBMITTED;

            case SUBMISSION_STATUS.ACKNOWLEDGED:
                return SUBMISSION_LIFECYCLE.ACKNOWLEDGED;

            case SUBMISSION_STATUS.ACCEPTED:
                return SUBMISSION_LIFECYCLE.ACCEPTED;

            case SUBMISSION_STATUS.REJECTED:
                return SUBMISSION_LIFECYCLE.REJECTED;

            case SUBMISSION_STATUS.FAILED:
                return SUBMISSION_LIFECYCLE.FAILED;

            case SUBMISSION_STATUS.NOT_SUPPORTED:
                return SUBMISSION_LIFECYCLE.FAILED;

            default:
                return SUBMISSION_LIFECYCLE.SUBMITTED;
        }
    }

    /**
     * =========================================================================
     * Submitted Result
     * =========================================================================
     */

    buildSubmittedResult(
        submission,
        context
    ) {
        const status =
            submission?.status ||
            SUBMISSION_STATUS.SUBMITTED;

        return {
            success:
                status ===
                SUBMISSION_STATUS.ACCEPTED,

            status,

            submissionId:
                context.submissionId ||
                null,

            reportId:
                context.reportId,

            tenantId:
                context.tenantId,

            idempotencyKey:
                context.idempotencyKey,

            reference:
                submission?.reference ||
                null,

            regulatorReference:
                submission?.regulatorReference ||
                null,

            submittedAt:
                submission?.submittedAt ||
                new Date(),
        };
    }

    /**
     * =========================================================================
     * Synchronous Acknowledgement Detection
     * =========================================================================
     */

    shouldParseAcknowledgement(
        submission
    ) {
        if (
            !submission
        ) {
            return false;
        }

        if (
            submission.status ===
                SUBMISSION_STATUS.ACCEPTED ||
            submission.status ===
                SUBMISSION_STATUS.REJECTED ||
            submission.status ===
                SUBMISSION_STATUS.ACKNOWLEDGED
        ) {
            return true;
        }

        return Boolean(
            submission.raw &&
            (
                submission.raw.accepted !==
                    undefined ||
                submission.raw.acknowledgement ||
                submission.raw.acknowledged
            )
        );
    }

    /**
     * =========================================================================
     * Report Fingerprint
     * =========================================================================
     */

    createReportFingerprint(
        report
    ) {
        const canonical = {
            id:
                report.id ||
                report.reportId ||
                null,

            type:
                report.type ||
                null,

            tenantId:
                report.tenantId ||
                null,

            version:
                report.version ||
                1,

            data:
                report.data ||
                report.payload ||
                report.content ||
                report,
        };

        return sha256(
            stableSerialize(
                canonical
            )
        );
    }

    /**
     * =========================================================================
     * Repository Error
     * =========================================================================
     */

    wrapRepositoryError(
        error,
        operation,
        context
    ) {
        return this.createError(
            'REGULATORY_SUBMISSION_REPOSITORY_ERROR',
            `Regulatory submission repository operation failed: ${operation}.`,
            context,
            {
                retryable:
                    true,

                cause:
                    error,

                operation,
            }
        );
    }

    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */

    isDuplicateError(
        error
    ) {
        return (
            error?.code ===
                11000 ||
            error?.code ===
                'DUPLICATE_KEY' ||
            error?.code ===
                'REGULATORY_SUBMISSION_DUPLICATE' ||
            error?.code ===
                'IDEMPOTENCY_CONFLICT'
        );
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async auditEvent(
        action,
        payload
    ) {

        try {

            if (
                typeof this.audit ===
                    'function'
            ) {

                await this.audit(
                    action,
                    payload
                );

                return;
            }

            if (
                this.audit &&
                typeof this.audit.record ===
                    'function'
            ) {

                await this.audit.record(
                    action,
                    payload
                );
            }

        } catch (
            error
        ) {

            this.logger.error?.({
                event:
                    'compliance.regulatory_submission.audit_failed',

                action,

                error:
                    error?.message,
            });
        }
    }

    /**
     * =========================================================================
     * Event Publishing
     * =========================================================================
     */

    async publishEvent(
        event,
        payload
    ) {

        try {

            if (
                typeof this.publisher ===
                    'function'
            ) {

                await this.publisher(
                    event,
                    payload
                );

                return;
            }

            if (
                this.publisher &&
                typeof this.publisher.publish ===
                    'function'
            ) {

                await this.publisher.publish(
                    event,
                    payload
                );

                return;
            }

            if (
                this.publisher &&
                typeof this.publisher.emit ===
                    'function'
            ) {

                this.publisher.emit(
                    event,
                    payload
                );
            }

        } catch (
            error
        ) {

            /**
             * Event publication must not turn an already successful regulator
             * submission into an application failure.
             */
            this.logger.error?.({
                event:
                    'compliance.regulatory_submission.event_publish_failed',

                targetEvent:
                    event,

                error:
                    error?.message,
            });
        }
    }

    /**
     * =========================================================================
     * Safe Context
     * =========================================================================
     */

    safeContext(
        context
    ) {
        if (
            !context
        ) {
            return {};
        }

        return {
            tenantId:
                context.tenantId ||
                null,

            reportId:
                context.reportId ||
                null,

            submissionId:
                context.submissionId ||
                null,

            reportType:
                context.reportType ||
                null,

            adapterName:
                context.adapterName ||
                null,

            countryCode:
                context.countryCode ||
                null,

            jurisdiction:
                context.jurisdiction ||
                null,

            regulatorCode:
                context.regulatorCode ||
                null,

            requestId:
                context.requestId ||
                null,

            correlationId:
                context.correlationId ||
                null,

            attempt:
                context.attempt ||
                1,

            idempotencyKey:
                context.idempotencyKey ||
                null,
        };
    }

    /**
     * =========================================================================
     * Safe Error
     * =========================================================================
     */

    safeError(
        error
    ) {
        if (
            !error
        ) {
            return null;
        }

        return {
            code:
                error.code ||
                'REGULATORY_SUBMISSION_ERROR',

            message:
                String(
                    error.message ||
                    'Regulatory submission failed.'
                ).slice(
                    0,
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            retryable:
                error.retryable ===
                true,

            stage:
                error.stage ||
                null,
        };
    }

    /**
     * =========================================================================
     * Safe Result
     * =========================================================================
     */

    safeResult(
        result
    ) {
        if (
            !result
        ) {
            return null;
        }

        return {
            success:
                result.success === true,

            status:
                result.status ||
                null,

            submissionId:
                result.submissionId ||
                null,

            reportId:
                result.reportId ||
                null,

            reference:
                result.reference ||
                null,

            regulatorReference:
                result.regulatorReference ||
                null,
        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let repositoryHealthy =
            !this.requireRepository;

        if (
            this.repository
        ) {
            repositoryHealthy =
                typeof this.repository.findOne ===
                    'function' ||
                typeof this.repository.findByIdempotencyKey ===
                    'function';
        }

        const registryAvailable =
            Boolean(
                this.registry
            );

        return {
            healthy:
                registryAvailable &&
                repositoryHealthy,

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            registryAvailable,

            calendarServiceAvailable:
                Boolean(
                    this.calendarService
                ),

            repositoryAvailable:
                Boolean(
                    this.repository
                ),

            repositoryHealthy,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    readiness() {

        return {
            ready:
                Boolean(
                    this.registry &&
                    (
                        this.repository ||
                        !this.requireRepository
                    )
                ),

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            registryAvailable:
                Boolean(
                    this.registry
                ),

            repositoryAvailable:
                Boolean(
                    this.repository
                ),

            calendarServiceAvailable:
                Boolean(
                    this.calendarService
                ),

            requireRepository:
                this.requireRepository,

            maxAttempts:
                this.maxAttempts,

            leaseMs:
                this.leaseMs,
        };
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {
        return {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            maxAttempts:
                this.maxAttempts,

            leaseMs:
                this.leaseMs,

            retryBaseMs:
                this.retryBaseMs,

            retryMaxMs:
                this.retryMaxMs,

            registryAvailable:
                Boolean(
                    this.registry
                ),

            calendarServiceAvailable:
                Boolean(
                    this.calendarService
                ),

            repositoryAvailable:
                Boolean(
                    this.repository
                ),

            requireRepository:
                this.requireRepository,
        };
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        code,
        message,
        context = {},
        options = {}
    ) {
        return new RegulatorySubmissionServiceError(
            message,
            code,
            {
                ...options,

                tenantId:
                    context.tenantId ||
                    options.tenantId ||
                    null,

                reportId:
                    context.reportId ||
                    options.reportId ||
                    null,

                submissionId:
                    context.submissionId ||
                    options.submissionId ||
                    null,

                idempotencyKey:
                    context.idempotencyKey ||
                    options.idempotencyKey ||
                    null,

                adapterName:
                    context.adapterName ||
                    options.adapterName ||
                    null,

                regulatorReference:
                    context.regulatorReference ||
                    options.regulatorReference ||
                    null,
            }
        );
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

RegulatorySubmissionService.SERVICE_NAME =
    SERVICE_NAME;

RegulatorySubmissionService.SERVICE_VERSION =
    SERVICE_VERSION;

RegulatorySubmissionService.SUBMISSION_LIFECYCLE =
    SUBMISSION_LIFECYCLE;

RegulatorySubmissionService.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RegulatorySubmissionService;

module.exports.RegulatorySubmissionService =
    RegulatorySubmissionService;

module.exports.RegulatorySubmissionServiceError =
    RegulatorySubmissionServiceError;

module.exports.SUBMISSION_LIFECYCLE =
    SUBMISSION_LIFECYCLE;

module.exports.SERVICE_NAME =
    SERVICE_NAME;

module.exports.SERVICE_VERSION =
    SERVICE_VERSION;