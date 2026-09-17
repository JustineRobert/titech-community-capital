'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Settlement Tracker
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/settlement/settlementTracker.js
 *
 * Architectural Role
 * ------------------
 * Enterprise settlement lifecycle tracking boundary for the Airtel payment
 * integration.
 *
 * The tracker records and exposes the operational lifecycle of a settlement.
 * It is intentionally separate from provider execution, reconciliation and
 * authoritative financial accounting.
 *
 * Responsibilities
 * ----------------
 * - Create settlement tracking records.
 * - Track lifecycle state transitions.
 * - Enforce supported state-transition rules.
 * - Maintain settlement timeline history.
 * - Preserve tenant isolation.
 * - Propagate correlation/execution/idempotency context.
 * - Synchronize externally supplied provider status into internal tracking
 *   status.
 * - Provide SLA monitoring hooks.
 * - Emit safe lifecycle events.
 * - Record operational audit entries.
 * - Expose operational statistics and health.
 * - Support graceful initialization.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API communication.
 * - OAuth/token management.
 * - Payment initiation.
 * - Settlement execution.
 * - Reconciliation rules or reconciliation decisions.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Double-entry accounting.
 * - Financial transaction authorization.
 * - Compliance/KYC/AML decisions.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Tracking state is operational state, not accounting state.
 * 2. COMPLETED here means the tracking lifecycle reached its configured
 *    completion state; it does not independently authorize ledger posting.
 * 3. Provider success is never converted into an accounting mutation here.
 * 4. Tenant identity is required for settlement lookups and transitions.
 * 5. State transitions are idempotent where repository capabilities permit.
 * 6. Atomic compare-and-set is preferred over read-then-write updates.
 * 7. Duplicate lifecycle events must not create duplicate financial side effects.
 * 8. Raw provider request/response bodies are not emitted or audited here.
 *
 * Security Principles
 * -------------------
 * - Never log credentials, tokens, signatures or raw provider payloads.
 * - Never trust arbitrary metadata for privileged state changes.
 * - Normalize and bound externally supplied strings.
 * - Preserve correlation and execution identifiers for traceability.
 * - Reject tenantless financial lifecycle operations.
 * - Use safe event and audit projections rather than complete records.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'SettlementTracker';
const VERSION = '1.0.0';

const SETTLEMENT_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    PENDING:
        'PENDING',

    PROCESSING:
        'PROCESSING',

    SUBMITTED:
        'SUBMITTED',

    PROVIDER_ACCEPTED:
        'PROVIDER_ACCEPTED',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    REVERSED:
        'REVERSED',

    CANCELLED:
        'CANCELLED',

    UNKNOWN:
        'UNKNOWN'

});

const TERMINAL_STATES = Object.freeze([
    SETTLEMENT_STATUS.COMPLETED,
    SETTLEMENT_STATUS.FAILED,
    SETTLEMENT_STATUS.REVERSED,
    SETTLEMENT_STATUS.CANCELLED
]);

/**
 * The transition matrix is deliberately conservative.
 *
 * UNKNOWN is treated as an investigation state. It can be reached from an
 * active state when an external/provider value cannot be mapped safely, but
 * automatic progression out of UNKNOWN is intentionally not inferred.
 *
 * FAILED / REVERSED / CANCELLED are terminal for this operational tracker.
 */
const ALLOWED_TRANSITIONS = Object.freeze({

    [SETTLEMENT_STATUS.CREATED]: Object.freeze([
        SETTLEMENT_STATUS.CREATED,
        SETTLEMENT_STATUS.PENDING,
        SETTLEMENT_STATUS.PROCESSING,
        SETTLEMENT_STATUS.CANCELLED,
        SETTLEMENT_STATUS.UNKNOWN
    ]),

    [SETTLEMENT_STATUS.PENDING]: Object.freeze([
        SETTLEMENT_STATUS.PENDING,
        SETTLEMENT_STATUS.PROCESSING,
        SETTLEMENT_STATUS.SUBMITTED,
        SETTLEMENT_STATUS.CANCELLED,
        SETTLEMENT_STATUS.FAILED,
        SETTLEMENT_STATUS.UNKNOWN
    ]),

    [SETTLEMENT_STATUS.PROCESSING]: Object.freeze([
        SETTLEMENT_STATUS.PROCESSING,
        SETTLEMENT_STATUS.SUBMITTED,
        SETTLEMENT_STATUS.PROVIDER_ACCEPTED,
        SETTLEMENT_STATUS.COMPLETED,
        SETTLEMENT_STATUS.FAILED,
        SETTLEMENT_STATUS.REVERSED,
        SETTLEMENT_STATUS.CANCELLED,
        SETTLEMENT_STATUS.UNKNOWN
    ]),

    [SETTLEMENT_STATUS.SUBMITTED]: Object.freeze([
        SETTLEMENT_STATUS.SUBMITTED,
        SETTLEMENT_STATUS.PROVIDER_ACCEPTED,
        SETTLEMENT_STATUS.COMPLETED,
        SETTLEMENT_STATUS.FAILED,
        SETTLEMENT_STATUS.REVERSED,
        SETTLEMENT_STATUS.UNKNOWN
    ]),

    [SETTLEMENT_STATUS.PROVIDER_ACCEPTED]: Object.freeze([
        SETTLEMENT_STATUS.PROVIDER_ACCEPTED,
        SETTLEMENT_STATUS.COMPLETED,
        SETTLEMENT_STATUS.FAILED,
        SETTLEMENT_STATUS.REVERSED,
        SETTLEMENT_STATUS.UNKNOWN
    ]),

    [SETTLEMENT_STATUS.COMPLETED]: Object.freeze([
        SETTLEMENT_STATUS.COMPLETED
    ]),

    [SETTLEMENT_STATUS.FAILED]: Object.freeze([
        SETTLEMENT_STATUS.FAILED
    ]),

    [SETTLEMENT_STATUS.REVERSED]: Object.freeze([
        SETTLEMENT_STATUS.REVERSED
    ]),

    [SETTLEMENT_STATUS.CANCELLED]: Object.freeze([
        SETTLEMENT_STATUS.CANCELLED
    ]),

    [SETTLEMENT_STATUS.UNKNOWN]: Object.freeze([
        SETTLEMENT_STATUS.UNKNOWN
    ])

});

const PROVIDER_STATUS_MAPPING = Object.freeze({

    SUCCESS:
        SETTLEMENT_STATUS.COMPLETED,

    COMPLETED:
        SETTLEMENT_STATUS.COMPLETED,

    FAILED:
        SETTLEMENT_STATUS.FAILED,

    ERROR:
        SETTLEMENT_STATUS.FAILED,

    PENDING:
        SETTLEMENT_STATUS.PROCESSING,

    PROCESSING:
        SETTLEMENT_STATUS.PROCESSING,

    SUBMITTED:
        SETTLEMENT_STATUS.SUBMITTED,

    ACCEPTED:
        SETTLEMENT_STATUS.PROVIDER_ACCEPTED,

    PROVIDER_ACCEPTED:
        SETTLEMENT_STATUS.PROVIDER_ACCEPTED,

    REVERSED:
        SETTLEMENT_STATUS.REVERSED,

    CANCELLED:
        SETTLEMENT_STATUS.CANCELLED,

    CANCELED:
        SETTLEMENT_STATUS.CANCELLED

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
const MAX_METADATA_KEYS = 50;
const MAX_TIMELINE_METADATA_KEYS = 25;

function truncate(value, maxLength = MAX_STRING_LENGTH) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const valueAsString =
        String(value);

    if (
        valueAsString.length <= maxLength
    ) {
        return valueAsString;
    }

    return `${valueAsString.slice(0, maxLength)}…`;
}

function sanitizeValue(
    value,
    key = '',
    depth = 0
) {

    if (depth > 5) {
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

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, 100)
            .map(item =>
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

        const entries =
            Object.entries(value)
                .slice(0, MAX_METADATA_KEYS);

        for (const [childKey, childValue] of entries) {

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

function safeError(error) {

    if (!error) {

        return {

            name:
                'Error',

            message:
                'Unknown error'

        };
    }

    return {

        name:
            truncate(
                error.name ||
                'Error',
                128
            ),

        message:
            truncate(
                error.message ||
                String(error),
                MAX_REASON_LENGTH
            ),

        code:
            truncate(
                error.code,
                128
            ),

        statusCode:
            Number.isFinite(error.statusCode)
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

    if (
        typeof tenantId === 'object' &&
        typeof tenantId.toString === 'function'
    ) {
        tenantId =
            tenantId.toString();
    }

    const normalized =
        String(tenantId)
            .trim();

    return normalized
        ? truncate(normalized, 128)
        : null;
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

function normalizeStatus(
    status
) {

    if (
        typeof status !== 'string'
    ) {

        throw new Error(
            'Settlement status must be a string'
        );
    }

    const normalized =
        status
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            SETTLEMENT_STATUS
        ).includes(normalized)
    ) {

        throw new Error(
            `Invalid settlement status ${normalized}`
        );
    }

    return normalized;
}

function normalizeProviderStatus(
    providerStatus
) {

    if (
        providerStatus === null ||
        providerStatus === undefined
    ) {
        return null;
    }

    const normalized =
        String(providerStatus)
            .trim()
            .toUpperCase();

    return normalized || null;
}

function normalizeReason(
    reason
) {

    if (
        reason === null ||
        reason === undefined
    ) {
        return undefined;
    }

    return truncate(
        reason,
        MAX_REASON_LENGTH
    );
}

function normalizeDate(
    value,
    fallback
) {

    const date =
        value === undefined ||
        value === null
            ? new Date(fallback)
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            'Invalid settlement timestamp'
        );
    }

    return date;
}

function normalizeMetadata(
    metadata
) {

    if (
        metadata === null ||
        metadata === undefined
    ) {
        return {};
    }

    if (
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {

        throw new Error(
            'Settlement metadata must be an object'
        );
    }

    return sanitizeValue(
        metadata
    );
}

function extractResultId(
    record
) {

    if (!record) {
        return null;
    }

    return (
        record.settlementId ??
        record.id ??
        record._id
            ? String(
                record.settlementId ??
                record.id ??
                record._id
            )
            : null
    );
}

class SettlementTracker {

    constructor({

        repository,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        clock = Date,

        slaMonitor,

        tenantResolver,

        authorizationService,

        maxTimelineEntries = 500,

        eventOnIdempotentTransition = false

    } = {}) {

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

        this.slaMonitor =
            slaMonitor;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.maxTimelineEntries =
            Number.isFinite(
                Number(maxTimelineEntries)
            ) &&
            Number(maxTimelineEntries) > 0
                ? Math.floor(
                    Number(maxTimelineEntries)
                )
                : 500;

        this.eventOnIdempotentTransition =
            Boolean(
                eventOnIdempotentTransition
            );

        this.statistics = {

            tracked:
                0,

            transitions:
                0,

            idempotentTransitions:
                0,

            rejectedTransitions:
                0,

            failures:
                0,

            completed:
                0,

            reversed:
                0,

            cancelled:
                0,

            providerStatusSyncs:
                0,

            unknownProviderStatuses:
                0

        };

        this.healthState = {

            status:
                'INITIALIZING',

            startedAt:
                this.now(),

            lastActivity:
                null,

            lastError:
                null

        };

        this.initialized =
            false;
    }

    /**
     * =========================================================================
     * Initialization
     * =========================================================================
     */

    async initialize() {

        this.validateDependencies();

        this.initialized =
            true;

        this.healthState.status =
            'READY';

        this.touchActivity();

        this.logger?.info?.({

            component:
                COMPONENT,

            provider:
                PROVIDER,

            message:
                'Airtel settlement tracker initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_settlement_tracker_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Create Settlement Tracking Record
     * =========================================================================
     */

    async create({

        tenantId,

        settlementId,

        providerReference,

        amount,

        currency,

        status =
            SETTLEMENT_STATUS.CREATED,

        metadata = {},

        correlationId =
            crypto.randomUUID(),

        executionId = null,

        idempotencyKey = null,

        actorId = null,

        session = null

    } = {}) {

        const span =
            this.startSpan(
                'airtel.settlement.tracker.create',
                {
                    tenantId,
                    settlementId,
                    correlationId,
                    executionId
                }
            );

        try {

            const normalizedTenantId =
                this.requireTenantId(
                    tenantId
                );

            const normalizedSettlementId =
                normalizeIdentifier(
                    settlementId,
                    'settlementId'
                );

            const normalizedStatus =
                normalizeStatus(
                    status
                );

            const normalizedCorrelationId =
                normalizeIdentifier(
                    correlationId,
                    'correlationId'
                );

            const normalizedMetadata =
                normalizeMetadata(
                    metadata
                );

            const now =
                this.now();

            const existing =
                await this.findExistingForCreate({
                    tenantId:
                        normalizedTenantId,
                    settlementId:
                        normalizedSettlementId,
                    idempotencyKey,
                    session
                });

            if (existing) {

                this.statistics.idempotentTransitions++;

                return existing;
            }

            const record = {

                settlementId:
                    normalizedSettlementId,

                tenantId:
                    normalizedTenantId,

                provider:
                    PROVIDER,

                providerReference:
                    providerReference === null ||
                    providerReference === undefined
                        ? undefined
                        : normalizeIdentifier(
                            providerReference,
                            'providerReference'
                        ),

                amount:
                    amount === null ||
                    amount === undefined
                        ? undefined
                        : String(amount),

                currency:
                    currency === null ||
                    currency === undefined
                        ? undefined
                        : truncate(
                            String(currency)
                                .trim()
                                .toUpperCase(),
                            16
                        ),

                status:
                    normalizedStatus,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    executionId
                        ? normalizeIdentifier(
                            executionId,
                            'executionId'
                        )
                        : undefined,

                idempotencyKey:
                    idempotencyKey
                        ? normalizeIdentifier(
                            idempotencyKey,
                            'idempotencyKey'
                        )
                        : undefined,

                metadata:
                    normalizedMetadata,

                timeline: [
                    {
                        status:
                            normalizedStatus,

                        timestamp:
                            now,

                        correlationId:
                            normalizedCorrelationId,

                        executionId:
                            executionId
                                ? String(executionId)
                                : undefined,

                        reason:
                            'TRACKING_CREATED',

                        metadata:
                            this.limitTimelineMetadata(
                                normalizedMetadata
                            )
                    }
                ],

                createdAt:
                    now,

                updatedAt:
                    now

            };

            const saved =
                await this.createRepositoryRecord(
                    record,
                    {
                        tenantId:
                            normalizedTenantId,
                        session
                    }
                );

            this.statistics.tracked++;

            this.touchActivity();

            await this.recordAuditSafe({

                action:
                    'SETTLEMENT_TRACKING_CREATED',

                tenantId:
                    normalizedTenantId,

                settlementId:
                    normalizedSettlementId,

                correlationId:
                    normalizedCorrelationId,

                executionId,

                actorId,

                status:
                    normalizedStatus

            });

            await this.publishTransitionEvent({
                settlementId:
                    normalizedSettlementId,
                tenantId:
                    normalizedTenantId,
                previousStatus:
                    null,
                status:
                    normalizedStatus,
                correlationId:
                    normalizedCorrelationId,
                executionId,
                reason:
                    'TRACKING_CREATED'
            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_created_total',
                1
            );

            return saved;

        } catch (error) {

            this.statistics.failures++;

            this.setHealthError(error);

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_create_failure_total',
                1
            );

            throw normalizeError(
                error,
                {
                    metadata: {
                        operation:
                            'settlement_tracking_create'
                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Transition Settlement State
     * =========================================================================
     */

    async transition({

        tenantId,

        settlementId,

        nextStatus,

        reason,

        metadata = {},

        correlationId =
            crypto.randomUUID(),

        executionId = null,

        idempotencyKey = null,

        actorId = null,

        providerStatus = null,

        session = null

    } = {}) {

        const span =
            this.startSpan(
                'airtel.settlement.tracker.transition',
                {
                    tenantId,
                    settlementId,
                    correlationId,
                    executionId
                }
            );

        try {

            const normalizedTenantId =
                this.requireTenantId(
                    tenantId
                );

            const normalizedSettlementId =
                normalizeIdentifier(
                    settlementId,
                    'settlementId'
                );

            const normalizedNextStatus =
                normalizeStatus(
                    nextStatus
                );

            const normalizedCorrelationId =
                normalizeIdentifier(
                    correlationId,
                    'correlationId'
                );

            const normalizedReason =
                normalizeReason(
                    reason
                );

            const normalizedMetadata =
                normalizeMetadata(
                    metadata
                );

            const current =
                await this.findBySettlementId({
                    tenantId:
                        normalizedTenantId,
                    settlementId:
                        normalizedSettlementId,
                    session
                });

            if (!current) {

                throw new Error(
                    'Settlement tracking record not found'
                );
            }

            const currentStatus =
                normalizeStatus(
                    current.status ||
                    SETTLEMENT_STATUS.UNKNOWN
                );

            const transitionAllowed =
                this.canTransition(
                    currentStatus,
                    normalizedNextStatus
                );

            if (!transitionAllowed) {

                this.statistics.rejectedTransitions++;

                this.metrics?.counter?.(
                    'payment_airtel_settlement_tracker_invalid_transition_total',
                    1
                );

                throw this.createTransitionError({
                    settlementId:
                        normalizedSettlementId,
                    tenantId:
                        normalizedTenantId,
                    currentStatus,
                    nextStatus:
                        normalizedNextStatus
                });
            }

            /*
             * A same-state transition is intentionally idempotent.
             *
             * This avoids duplicate timeline entries when providers repeat
             * the same status during polling/callback synchronization.
             */
            if (
                currentStatus ===
                normalizedNextStatus
            ) {

                this.statistics.idempotentTransitions++;

                this.touchActivity();

                if (
                    this.eventOnIdempotentTransition
                ) {

                    await this.publishTransitionEvent({
                        settlementId:
                            normalizedSettlementId,

                        tenantId:
                            normalizedTenantId,

                        previousStatus:
                            currentStatus,

                        status:
                            normalizedNextStatus,

                        correlationId:
                            normalizedCorrelationId,

                        executionId,

                        reason:
                            normalizedReason ||
                            'IDEMPOTENT_STATUS_CONFIRMATION'

                    });
                }

                return current;
            }

            const now =
                this.now();

            const timelineEntry = {

                status:
                    normalizedNextStatus,

                previousStatus:
                    currentStatus,

                reason:
                    normalizedReason,

                metadata:
                    this.limitTimelineMetadata(
                        normalizedMetadata
                    ),

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    executionId
                        ? String(executionId)
                        : undefined,

                providerStatus:
                    providerStatus
                        ? truncate(
                            String(
                                providerStatus
                            ),
                            128
                        )
                        : undefined,

                timestamp:
                    now

            };

            const result =
                await this.applyTransition({
                    tenantId:
                        normalizedTenantId,

                    settlementId:
                        normalizedSettlementId,

                    current,

                    currentStatus,

                    nextStatus:
                        normalizedNextStatus,

                    timelineEntry,

                    now,

                    idempotencyKey,

                    session

                });

            this.statistics.transitions++;

            if (
                normalizedNextStatus ===
                SETTLEMENT_STATUS.COMPLETED
            ) {

                this.statistics.completed++;

            }

            if (
                normalizedNextStatus ===
                SETTLEMENT_STATUS.FAILED
            ) {

                this.statistics.failures++;

            }

            if (
                normalizedNextStatus ===
                SETTLEMENT_STATUS.REVERSED
            ) {

                this.statistics.reversed++;

            }

            if (
                normalizedNextStatus ===
                SETTLEMENT_STATUS.CANCELLED
            ) {

                this.statistics.cancelled++;

            }

            this.touchActivity();

            await this.recordAuditSafe({

                action:
                    'SETTLEMENT_TRACKING_STATUS_CHANGED',

                tenantId:
                    normalizedTenantId,

                settlementId:
                    normalizedSettlementId,

                correlationId:
                    normalizedCorrelationId,

                executionId,

                actorId,

                previousStatus:
                    currentStatus,

                status:
                    normalizedNextStatus,

                reason:
                    normalizedReason,

                providerStatus:
                    providerStatus
                        ? truncate(
                            String(
                                providerStatus
                            ),
                            128
                        )
                        : undefined

            });

            await this.publishTransitionEvent({

                settlementId:
                    normalizedSettlementId,

                tenantId:
                    normalizedTenantId,

                previousStatus:
                    currentStatus,

                status:
                    normalizedNextStatus,

                correlationId:
                    normalizedCorrelationId,

                executionId,

                reason:
                    normalizedReason,

                providerStatus

            });

            await this.evaluateSLAAfterTransition({
                tenantId:
                    normalizedTenantId,

                settlementId:
                    normalizedSettlementId,

                status:
                    normalizedNextStatus,

                correlationId:
                    normalizedCorrelationId
            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_transition_total',
                1
            );

            return result;

        } catch (error) {

            this.setHealthError(error);

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_transition_failure_total',
                1
            );

            throw normalizeError(
                error,
                {
                    metadata: {
                        operation:
                            'settlement_tracking_transition'
                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Provider Status Synchronization
     * =========================================================================
     *
     * This method only translates an externally supplied status to an internal
     * tracking state. It does not assume that every provider status means a
     * financial settlement has occurred.
     */

    async synchronizeProviderStatus({

        tenantId,

        settlementId,

        providerStatus,

        correlationId =
            crypto.randomUUID(),

        executionId = null,

        metadata = {},

        session = null

    } = {}) {

        const normalizedProviderStatus =
            normalizeProviderStatus(
                providerStatus
            );

        if (!normalizedProviderStatus) {

            throw new Error(
                'providerStatus is required'
            );
        }

        this.statistics.providerStatusSyncs++;

        const mappedStatus =
            PROVIDER_STATUS_MAPPING[
                normalizedProviderStatus
            ];

        if (!mappedStatus) {

            this.statistics.unknownProviderStatuses++;

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_unknown_provider_status_total',
                1
            );

            return this.transition({

                tenantId,

                settlementId,

                nextStatus:
                    SETTLEMENT_STATUS.UNKNOWN,

                correlationId,

                executionId,

                metadata,

                providerStatus:
                    normalizedProviderStatus,

                reason:
                    'PROVIDER_STATUS_UNMAPPED',

                session

            });
        }

        return this.transition({

            tenantId,

            settlementId,

            nextStatus:
                mappedStatus,

            correlationId,

            executionId,

            metadata,

            providerStatus:
                normalizedProviderStatus,

            reason:
                'PROVIDER_STATUS_SYNC',

            session

        });
    }

    /**
     * =========================================================================
     * Find Settlement Timeline
     * =========================================================================
     */

    async timeline(
        settlementId,
        {
            tenantId,
            session = null
        } = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedSettlementId =
            normalizeIdentifier(
                settlementId,
                'settlementId'
            );

        this.touchActivity();

        if (
            typeof this.repository.getTimelineForTenant ===
            'function'
        ) {

            return this.repository.getTimelineForTenant(
                normalizedTenantId,
                normalizedSettlementId,
                {
                    session
                }
            );
        }

        if (
            typeof this.repository.getTimeline ===
            'function'
        ) {

            return this.repository.getTimeline(
                normalizedSettlementId,
                {
                    tenantId:
                        normalizedTenantId,
                    session
                }
            );
        }

        const record =
            await this.findBySettlementId({
                tenantId:
                    normalizedTenantId,
                settlementId:
                    normalizedSettlementId,
                session
            });

        return record?.timeline || [];
    }

    /**
     * =========================================================================
     * SLA Tracking
     * =========================================================================
     */

    async evaluateSLA({

        settlementId,

        tenantId,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        if (!this.slaMonitor) {
            return null;
        }

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedSettlementId =
            normalizeIdentifier(
                settlementId,
                'settlementId'
            );

        try {

            if (
                typeof this.slaMonitor.evaluate !==
                'function'
            ) {

                return null;
            }

            return await this.slaMonitor.evaluate({

                tenantId:
                    normalizedTenantId,

                settlementId:
                    normalizedSettlementId,

                correlationId

            });

        } catch (error) {

            this.logger?.warn?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Airtel settlement SLA evaluation failed',

                tenantId:
                    normalizedTenantId,

                settlementId:
                    normalizedSettlementId,

                correlationId,

                error:
                    safeError(error)

            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_sla_failure_total',
                1
            );

            return null;
        }
    }

    /**
     * =========================================================================
     * Publish Transition Event
     * =========================================================================
     *
     * The event is deliberately a safe operational projection. The full
     * settlement record, provider response, financial metadata and credentials
     * are never emitted by this component.
     */

    async publishTransitionEvent({

        settlementId,

        tenantId,

        previousStatus,

        status,

        correlationId,

        executionId = null,

        reason,

        providerStatus = null

    }) {

        const event = {

            type:
                'SETTLEMENT_STATUS_CHANGED',

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId,

            settlementId,

            correlationId,

            executionId,

            payload: {

                settlementId,

                provider:
                    PROVIDER,

                previousStatus,

                status,

                reason:
                    reason
                        ? truncate(
                            reason,
                            MAX_REASON_LENGTH
                        )
                        : undefined,

                providerStatus:
                    providerStatus
                        ? truncate(
                            String(
                                providerStatus
                            ),
                            128
                        )
                        : undefined

            }

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

                this.logger?.debug?.({

                    component:
                        COMPONENT,

                    provider:
                        PROVIDER,

                    message:
                        'No settlement tracker event publisher configured',

                    tenantId,

                    settlementId,

                    correlationId

                });

                return false;
            }

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_event_published_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_event_publish_failure_total',
                1
            );

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to publish Airtel settlement tracker event',

                tenantId,

                settlementId,

                correlationId,

                executionId,

                error:
                    safeError(error)

            });

            /*
             * Publishing is an operational side effect and must not rewrite
             * the persisted settlement lifecycle result.
             */
            return false;
        }
    }

    /**
     * =========================================================================
     * Terminal State
     * =========================================================================
     */

    isTerminal(
        status
    ) {

        return TERMINAL_STATES.includes(
            status
        );
    }

    /**
     * =========================================================================
     * Transition Validation
     * =========================================================================
     */

    canTransition(
        currentStatus,
        nextStatus
    ) {

        const allowed =
            ALLOWED_TRANSITIONS[
                currentStatus
            ];

        if (!allowed) {
            return false;
        }

        return allowed.includes(
            nextStatus
        );
    }

    createTransitionError({

        tenantId,

        settlementId,

        currentStatus,

        nextStatus

    }) {

        const error =
            new Error(
                `Invalid Airtel settlement transition ${currentStatus} -> ${nextStatus}`
            );

        error.code =
            'AIRTEL_SETTLEMENT_INVALID_STATE_TRANSITION';

        error.tenantId =
            tenantId;

        error.settlementId =
            settlementId;

        error.currentStatus =
            currentStatus;

        error.nextStatus =
            nextStatus;

        return error;
    }

    /**
     * =========================================================================
     * Repository Operations
     * =========================================================================
     */

    async findExistingForCreate({

        tenantId,

        settlementId,

        idempotencyKey,

        session

    }) {

        if (
            idempotencyKey &&
            typeof this.repository.findByIdempotencyKey ===
            'function'
        ) {

            const byIdempotency =
                await this.repository
                    .findByIdempotencyKey(
                        tenantId,
                        idempotencyKey,
                        {
                            session
                        }
                    );

            if (byIdempotency) {
                return byIdempotency;
            }
        }

        return this.findBySettlementId({
            tenantId,
            settlementId,
            session
        });
    }

    async findBySettlementId({

        tenantId,

        settlementId,

        session

    }) {

        if (
            typeof this.repository.findBySettlementIdForTenant ===
            'function'
        ) {

            return this.repository
                .findBySettlementIdForTenant(
                    tenantId,
                    settlementId,
                    {
                        session
                    }
                );
        }

        if (
            typeof this.repository.findOne ===
            'function'
        ) {

            return this.repository.findOne({

                tenantId,

                settlementId

            }, {
                session
            });
        }

        if (
            typeof this.repository.findBySettlementId ===
            'function'
        ) {

            /*
             * Compatibility path for repositories whose historical signature
             * accepted only settlementId. We still pass tenant context when
             * the repository supports an options object.
             */
            return this.repository
                .findBySettlementId(
                    settlementId,
                    {
                        tenantId,
                        session
                    }
                );
        }

        throw new Error(
            'Settlement repository does not expose a supported lookup operation'
        );
    }

    async createRepositoryRecord(
        record,
        {
            tenantId,
            session
        } = {}
    ) {

        if (
            typeof this.repository.createForTenant ===
            'function'
        ) {

            return this.repository.createForTenant(
                tenantId,
                record,
                {
                    session
                }
            );
        }

        if (
            typeof this.repository.create ===
            'function'
        ) {

            return this.repository.create(
                record,
                {
                    session
                }
            );
        }

        throw new Error(
            'Settlement repository does not expose create()'
        );
    }

    /**
     * =========================================================================
     * Atomic State Application
     * =========================================================================
     */

    async applyTransition({

        tenantId,

        settlementId,

        current,

        currentStatus,

        nextStatus,

        timelineEntry,

        now,

        idempotencyKey,

        session

    }) {

        const transitionContext = {

            tenantId,

            settlementId,

            currentStatus,

            nextStatus,

            idempotencyKey,

            timelineEntry,

            updatedAt:
                now,

            session

        };

        /*
         * Preferred:
         * repository owns atomic compare-and-set semantics.
         */
        if (
            typeof this.repository.compareAndSetStatus ===
            'function'
        ) {

            const result =
                await this.repository
                    .compareAndSetStatus(
                        transitionContext
                    );

            if (!result) {

                /*
                 * A concurrent writer may have changed the state after our
                 * initial read. Re-read and determine whether it converged
                 * idempotently.
                 */
                const latest =
                    await this.findBySettlementId({
                        tenantId,
                        settlementId,
                        session
                    });

                if (
                    latest &&
                    latest.status ===
                    nextStatus
                ) {

                    this.statistics.idempotentTransitions++;

                    return latest;
                }

                throw new Error(
                    'Settlement status changed concurrently'
                );
            }

            return result;
        }

        /*
         * Alternate atomic repository contract.
         */
        if (
            typeof this.repository.atomicTransition ===
            'function'
        ) {

            const result =
                await this.repository.atomicTransition(
                    transitionContext
                );

            if (!result) {

                const latest =
                    await this.findBySettlementId({
                        tenantId,
                        settlementId,
                        session
                    });

                if (
                    latest &&
                    latest.status ===
                    nextStatus
                ) {

                    this.statistics.idempotentTransitions++;

                    return latest;
                }

                throw new Error(
                    'Atomic settlement transition could not be applied'
                );
            }

            return result;
        }

        /*
         * Legacy compatibility path.
         *
         * This path is intentionally explicit and warning-backed. The
         * repository should ultimately provide an atomic transition primitive
         * because settlement state can be updated by callbacks, polling,
         * scheduler jobs and manual operations concurrently.
         */
        this.logger?.warn?.({

            component:
                COMPONENT,

            provider:
                PROVIDER,

            message:
                'Using non-atomic settlement repository transition compatibility path',

            tenantId,

            settlementId,

            currentStatus,

            nextStatus

        });

        if (
            typeof this.repository.update ===
            'function'
        ) {

            const update = {

                status:
                    nextStatus,

                updatedAt:
                    now,

                $push: {

                    timeline:
                        timelineEntry

                }

            };

            if (
                typeof this.repository.updateForTenant ===
                'function'
            ) {

                return this.repository.updateForTenant(
                    tenantId,
                    settlementId,
                    update,
                    {
                        session,
                        expectedStatus:
                            currentStatus,
                        idempotencyKey
                    }
                );
            }

            return this.repository.update(
                settlementId,
                update,
                {
                    tenantId,
                    session,
                    expectedStatus:
                        currentStatus,
                    idempotencyKey
                }
            );
        }

        throw new Error(
            'Settlement repository does not expose a supported transition operation'
        );
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAuditSafe(
        auditRecord
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
                    ...auditRecord,
                    provider:
                        PROVIDER,
                    component:
                        COMPONENT,
                    occurredAt:
                        this.now()
                })
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_audit_success_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_audit_failure_total',
                1
            );

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to record Airtel settlement tracker audit',

                settlementId:
                    auditRecord?.settlementId,

                tenantId:
                    auditRecord?.tenantId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * SLA Post-Transition Hook
     * =========================================================================
     */

    async evaluateSLAAfterTransition({

        tenantId,

        settlementId,

        status,

        correlationId

    }) {

        if (!this.slaMonitor) {
            return null;
        }

        try {

            if (
                typeof this.slaMonitor.onTransition ===
                'function'
            ) {

                return await this.slaMonitor
                    .onTransition({

                        tenantId,

                        settlementId,

                        status,

                        correlationId

                    });
            }

            if (
                typeof this.slaMonitor.evaluate ===
                'function'
            ) {

                return await this.slaMonitor
                    .evaluate({

                        tenantId,

                        settlementId,

                        status,

                        correlationId

                    });
            }

        } catch (error) {

            this.logger?.warn?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Airtel settlement SLA post-transition hook failed',

                tenantId,

                settlementId,

                status,

                correlationId,

                error:
                    safeError(error)

            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_tracker_sla_failure_total',
                1
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Tenant / Security Helpers
     * =========================================================================
     */

    requireTenantId(
        tenantId
    ) {

        const normalized =
            normalizeTenantId(
                tenantId
            );

        if (!normalized) {

            throw new Error(
                'tenantId is required for Airtel settlement tracking'
            );
        }

        return normalized;
    }

    /**
     * Optional authorization hook.
     *
     * The tracker does not invent authorization semantics. Where the existing
     * application supplies an authorization service, this hook gives the
     * surrounding application an explicit extension point.
     */
    async authorize(
        operationContext
    ) {

        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            typeof this.authorizationService.authorize ===
            'function'
        ) {

            const result =
                await this.authorizationService
                    .authorize(
                        operationContext
                    );

            if (result === false) {

                throw new Error(
                    'Airtel settlement tracker operation not authorized'
                );
            }

            return true;
        }

        return true;
    }

    /**
     * =========================================================================
     * Timeline Controls
     * =========================================================================
     */

    limitTimelineMetadata(
        metadata
    ) {

        const safe =
            sanitizeValue(
                metadata
            );

        if (
            !safe ||
            typeof safe !== 'object' ||
            Array.isArray(safe)
        ) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(safe)
                .slice(
                    0,
                    MAX_TIMELINE_METADATA_KEYS
                )
        );
    }

    /**
     * =========================================================================
     * Clock / Activity
     * =========================================================================
     */

    now() {

        return new this.clock();
    }

    touchActivity() {

        this.healthState.lastActivity =
            this.now();

        if (
            this.healthState.status ===
            'INITIALIZING' &&
            this.initialized
        ) {

            this.healthState.status =
                'READY';
        }
    }

    setHealthError(
        error
    ) {

        this.healthState.lastError =
            safeError(error);

        if (
            this.healthState.status !==
            'INITIALIZING'
        ) {

            this.healthState.status =
                'DEGRADED';
        }
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
                    value !== undefined &&
                    value !== null
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch (error) {

            this.logger?.debug?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Unable to start Airtel settlement tracker trace span',

                error:
                    safeError(error)

            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.repository
        ) {

            throw new Error(
                'Settlement repository required'
            );
        }

        const hasLookup =
            typeof this.repository.findBySettlementIdForTenant ===
                'function' ||
            typeof this.repository.findOne ===
                'function' ||
            typeof this.repository.findBySettlementId ===
                'function';

        if (!hasLookup) {

            throw new Error(
                'Settlement repository lookup operation required'
            );
        }

        const hasCreate =
            typeof this.repository.createForTenant ===
                'function' ||
            typeof this.repository.create ===
                'function';

        if (!hasCreate) {

            throw new Error(
                'Settlement repository create operation required'
            );
        }

        const hasTransition =
            typeof this.repository.compareAndSetStatus ===
                'function' ||
            typeof this.repository.atomicTransition ===
                'function' ||
            typeof this.repository.updateForTenant ===
                'function' ||
            typeof this.repository.update ===
                'function';

        if (!hasTransition) {

            throw new Error(
                'Settlement repository transition operation required'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const repositoryAvailable =
            Boolean(
                this.repository
            );

        const lookupAvailable =
            repositoryAvailable &&
            (
                typeof this.repository.findBySettlementIdForTenant ===
                    'function' ||
                typeof this.repository.findOne ===
                    'function' ||
                typeof this.repository.findBySettlementId ===
                    'function'
            );

        const createAvailable =
            repositoryAvailable &&
            (
                typeof this.repository.createForTenant ===
                    'function' ||
                typeof this.repository.create ===
                    'function'
            );

        const transitionAvailable =
            repositoryAvailable &&
            (
                typeof this.repository.compareAndSetStatus ===
                    'function' ||
                typeof this.repository.atomicTransition ===
                    'function' ||
                typeof this.repository.updateForTenant ===
                    'function' ||
                typeof this.repository.update ===
                    'function'
            );

        let status =
            this.healthState.status;

        if (
            !repositoryAvailable ||
            !lookupAvailable ||
            !createAvailable ||
            !transitionAvailable
        ) {

            status =
                'DOWN';

        } else if (
            status === 'INITIALIZING'
        ) {

            status =
                'DEGRADED';

        } else if (
            status === 'DEGRADED'
        ) {

            status =
                'DEGRADED';

        } else {

            status =
                'UP';
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

            startedAt:
                this.healthState.startedAt,

            lastActivity:
                this.healthState.lastActivity,

            lastError:
                this.healthState.lastError,

            dependencies: {

                repository:
                    repositoryAvailable,

                repositoryLookup:
                    lookupAvailable,

                repositoryCreate:
                    createAvailable,

                repositoryTransition:
                    transitionAvailable,

                audit:
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
                    ),

                slaMonitor:
                    Boolean(
                        this.slaMonitor
                    )

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

            ...this.statistics

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

            initialized:
                this.initialized,

            statistics:
                {
                    ...this.statistics
                },

            health:
                {
                    ...this.healthState
                }

        };
    }

    /**
     * =========================================================================
     * Graceful Shutdown Hook
     * =========================================================================
     */

    async shutdown() {

        this.healthState.status =
            'STOPPING';

        this.logger?.info?.({

            component:
                COMPONENT,

            provider:
                PROVIDER,

            message:
                'Airtel settlement tracker shutting down'

        });

        this.initialized =
            false;

        return true;
    }
}

module.exports = {

    SettlementTracker,

    SETTLEMENT_STATUS,

    TERMINAL_STATES,

    ALLOWED_TRANSITIONS,

    PROVIDER_STATUS_MAPPING,

    PROVIDER,

    COMPONENT,

    VERSION
};