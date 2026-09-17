'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Settlement Scheduler
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/settlement/settlementScheduler.js
 *
 * Architectural Role
 * ------------------
 * Enterprise orchestration boundary for automated Airtel settlement processing
 * and reconciliation.
 *
 * Responsibilities
 * ----------------
 * - Schedule settlement/reconciliation execution.
 * - Support controlled manual execution.
 * - Enforce process-local concurrency limits.
 * - Enforce distributed execution locking.
 * - Renew distributed leases when supported.
 * - Execute work independently for each active tenant.
 * - Propagate tenant, correlation, execution and idempotency context.
 * - Coordinate settlement processing before reconciliation.
 * - Continue processing unaffected tenants after an individual tenant failure.
 * - Produce an authoritative run summary.
 * - Publish safe lifecycle events through the configured event/outbox boundary.
 * - Record operational audit entries.
 * - Emit metrics and tracing information.
 * - Expose health and diagnostic information.
 * - Support graceful shutdown without terminating active financial workflows.
 *
 * Non-Responsibilities
 * --------------------
 * - Airtel HTTP/API communication.
 * - OAuth/token management.
 * - Payment initiation.
 * - Direct balance mutation.
 * - Direct ledger posting.
 * - Direct Mongo financial transaction mutation.
 * - Provider callback handling.
 * - Provider reconciliation rules.
 * - Settlement accounting decisions.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Scheduler orchestration is not a financial accounting boundary.
 * 2. SettlementService owns provider-facing settlement execution.
 * 3. SettlementReconciler owns reconciliation rules and evidence matching.
 * 4. The scheduler never directly mutates balances, wallets or ledgers.
 * 5. Provider acknowledgement does not equal financial settlement completion.
 * 6. Every execution carries tenant + correlation + execution context.
 * 7. Distributed locking prevents duplicate scheduler execution.
 * 8. Lease renewal is attempted when the lock implementation supports it.
 * 9. Tenant failures are isolated so one tenant cannot suppress all tenants.
 * 10. Raw provider responses and sensitive data are never published by the
 *     scheduler as lifecycle events or audit metadata.
 *
 * Operational Principles
 * ----------------------
 * - Fail closed on invalid scheduler configuration.
 * - Never silently swallow execution errors.
 * - Prefer outbox/event publisher over direct event bus when available.
 * - Prefer structured logs with bounded/safe metadata.
 * - Preserve graceful shutdown semantics.
 * - Avoid unbounded tenant execution concurrency.
 * - Do not assume undocumented Airtel provider contracts.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'SettlementScheduler';

const TRIGGERS = Object.freeze({
    SCHEDULED: 'SCHEDULED',
    MANUAL: 'MANUAL'
});

const RUN_STATUS = Object.freeze({
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    PARTIAL_FAILURE: 'PARTIAL_FAILURE',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED',
    STOPPING: 'STOPPING'
});

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TENANT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_TENANTS = 10_000;
const DEFAULT_MAX_FAILURE_DETAILS = 100;

const MAX_SAFE_STRING_LENGTH = 512;
const MAX_SAFE_ERROR_MESSAGE_LENGTH = 1_000;

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
    'providerResponse',
    'providerRequest',
    'credentials'
]);

function isPositiveFiniteNumber(value) {
    return Number.isFinite(value) && value > 0;
}

function normalizePositiveInteger(value, fallback) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();

        if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
        }

        if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return fallback;
}

function truncateString(value, maxLength = MAX_SAFE_STRING_LENGTH) {
    if (value === undefined || value === null) {
        return value;
    }

    const stringValue = String(value);

    if (stringValue.length <= maxLength) {
        return stringValue;
    }

    return `${stringValue.slice(0, maxLength)}…`;
}

function sanitizeValue(value, key = '', depth = 0) {
    if (depth > 5) {
        return '[Truncated]';
    }

    if (value === null || value === undefined) {
        return value;
    }

    const normalizedKey = String(key || '').toLowerCase();

    if (
        SENSITIVE_KEYS.has(key) ||
        SENSITIVE_KEYS.has(normalizedKey)
    ) {
        return '[REDACTED]';
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return typeof value === 'string'
            ? truncateString(value)
            : value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, 100)
            .map(item => sanitizeValue(item, '', depth + 1));
    }

    if (typeof value === 'object') {
        const output = {};

        for (const [childKey, childValue] of Object.entries(value)) {
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

    return truncateString(value);
}

function safeError(error) {
    if (!error) {
        return {
            name: 'Error',
            message: 'Unknown error'
        };
    }

    return {
        name: truncateString(
            error.name || 'Error',
            128
        ),
        message: truncateString(
            error.message || String(error),
            MAX_SAFE_ERROR_MESSAGE_LENGTH
        ),
        code: truncateString(
            error.code,
            128
        ),
        statusCode:
            Number.isFinite(error.statusCode)
                ? error.statusCode
                : undefined
    };
}

function getTenantId(tenant) {
    if (!tenant) {
        return null;
    }

    const candidate =
        tenant.tenantId ??
        tenant.id ??
        tenant._id;

    if (candidate === null || candidate === undefined) {
        return null;
    }

    if (
        typeof candidate === 'object' &&
        typeof candidate.toString === 'function'
    ) {
        return candidate.toString();
    }

    return String(candidate);
}

function getTenantKey(tenant) {
    return getTenantId(tenant);
}

function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function normalizeDate(value) {
    const date =
        value instanceof Date
            ? new Date(value.getTime())
            : new Date(value);

    if (!isValidDate(date)) {
        throw new TypeError('settlementDate must be a valid date');
    }

    return date;
}

function createError(message, code = 'AIRTEL_SETTLEMENT_SCHEDULER_ERROR') {
    const error = new Error(message);
    error.code = code;
    return error;
}

class SettlementScheduler {

    constructor({
        settlementService,
        settlementReconciler,
        tenantRepository,
        distributedLock,

        eventBus,
        outboxService,
        eventPublisher,

        auditService,

        logger,
        metrics,
        tracer,

        intervalMs = (
            process.env.AIRTEL_SETTLEMENT_INTERVAL_MS ||
            DEFAULT_INTERVAL_MS
        ),

        lockTtlMs = (
            process.env.AIRTEL_SETTLEMENT_LOCK_TTL_MS ||
            DEFAULT_LOCK_TTL_MS
        ),

        lockRenewIntervalMs = (
            process.env.AIRTEL_SETTLEMENT_LOCK_RENEW_INTERVAL_MS ||
            DEFAULT_LOCK_RENEW_INTERVAL_MS
        ),

        tenantTimeoutMs = (
            process.env.AIRTEL_SETTLEMENT_TENANT_TIMEOUT_MS ||
            DEFAULT_TENANT_TIMEOUT_MS
        ),

        enabled = true,

        maxConcurrentRuns = (
            process.env.AIRTEL_SETTLEMENT_MAX_CONCURRENT_RUNS ||
            DEFAULT_MAX_CONCURRENT_RUNS
        ),

        maxTenants = (
            process.env.AIRTEL_SETTLEMENT_MAX_TENANTS ||
            DEFAULT_MAX_TENANTS
        ),

        maxFailureDetails = DEFAULT_MAX_FAILURE_DETAILS,

        failRunOnTenantError = true,

        continueOnTenantError = true
    } = {}) {

        this.settlementService = settlementService;
        this.settlementReconciler = settlementReconciler;
        this.tenantRepository = tenantRepository;
        this.distributedLock = distributedLock;

        this.eventBus = eventBus;
        this.outboxService = outboxService;
        this.eventPublisher = eventPublisher;

        this.auditService = auditService;

        this.logger = logger;
        this.metrics = metrics;
        this.tracer = tracer;

        this.intervalMs =
            normalizePositiveInteger(
                intervalMs,
                DEFAULT_INTERVAL_MS
            );

        this.lockTtlMs =
            normalizePositiveInteger(
                lockTtlMs,
                DEFAULT_LOCK_TTL_MS
            );

        this.lockRenewIntervalMs =
            normalizePositiveInteger(
                lockRenewIntervalMs,
                DEFAULT_LOCK_RENEW_INTERVAL_MS
            );

        this.tenantTimeoutMs =
            normalizePositiveInteger(
                tenantTimeoutMs,
                DEFAULT_TENANT_TIMEOUT_MS
            );

        this.enabled =
            normalizeBoolean(
                enabled,
                true
            );

        this.maxConcurrentRuns =
            normalizePositiveInteger(
                maxConcurrentRuns,
                DEFAULT_MAX_CONCURRENT_RUNS
            );

        this.maxTenants =
            normalizePositiveInteger(
                maxTenants,
                DEFAULT_MAX_TENANTS
            );

        this.maxFailureDetails =
            normalizePositiveInteger(
                maxFailureDetails,
                DEFAULT_MAX_FAILURE_DETAILS
            );

        this.failRunOnTenantError =
            Boolean(failRunOnTenantError);

        this.continueOnTenantError =
            Boolean(continueOnTenantError);

        this.timer = null;
        this.leaseRenewTimer = null;
        this.runningCount = 0;
        this.stopping = false;
        this.startedAt = null;

        this.activeExecutions = new Map();

        this.statistics = {

            scheduledRuns: 0,

            manualRuns: 0,

            successfulRuns: 0,

            partiallyFailedRuns: 0,

            failedRuns: 0,

            skippedRuns: 0,

            activeRuns: 0,

            activeTenantExecutions: 0,

            totalTenantsProcessed: 0,

            totalTenantFailures: 0,

            lastRunStartedAt: null,

            lastRunCompletedAt: null,

            lastSuccessfulRunAt: null,

            lastFailure: null

        };

        this.validateConfiguration();
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        if (!isPositiveFiniteNumber(this.intervalMs)) {
            throw createError(
                'Airtel settlement scheduler interval must be positive',
                'AIRTEL_SETTLEMENT_INVALID_INTERVAL'
            );
        }

        if (!isPositiveFiniteNumber(this.lockTtlMs)) {
            throw createError(
                'Airtel settlement scheduler lock TTL must be positive',
                'AIRTEL_SETTLEMENT_INVALID_LOCK_TTL'
            );
        }

        if (!isPositiveFiniteNumber(this.lockRenewIntervalMs)) {
            throw createError(
                'Airtel settlement scheduler lock renewal interval must be positive',
                'AIRTEL_SETTLEMENT_INVALID_LOCK_RENEW_INTERVAL'
            );
        }

        if (this.lockRenewIntervalMs >= this.lockTtlMs) {
            this.logger?.warn?.({
                component: COMPONENT,
                message:
                    'Settlement scheduler lock renewal interval is not below lock TTL; lease renewal may be unsafe',
                lockTtlMs: this.lockTtlMs,
                lockRenewIntervalMs: this.lockRenewIntervalMs
            });
        }

        if (!isPositiveFiniteNumber(this.tenantTimeoutMs)) {
            throw createError(
                'Airtel settlement scheduler tenant timeout must be positive',
                'AIRTEL_SETTLEMENT_INVALID_TENANT_TIMEOUT'
            );
        }

        if (this.maxConcurrentRuns < 1) {
            throw createError(
                'Airtel settlement scheduler maxConcurrentRuns must be at least 1',
                'AIRTEL_SETTLEMENT_INVALID_CONCURRENCY'
            );
        }

        if (this.maxTenants < 1) {
            throw createError(
                'Airtel settlement scheduler maxTenants must be at least 1',
                'AIRTEL_SETTLEMENT_INVALID_MAX_TENANTS'
            );
        }

        if (this.maxConcurrentRuns > 1) {
            this.logger?.warn?.({
                component: COMPONENT,
                message:
                    'maxConcurrentRuns is greater than one; distributed settlement locking still applies',
                maxConcurrentRuns:
                    this.maxConcurrentRuns
            });
        }

        return true;
    }

    /**
     * =========================================================================
     * Start Scheduler
     * =========================================================================
     */

    async start() {

        if (!this.enabled) {

            this.logger?.warn?.({
                component: COMPONENT,
                provider: PROVIDER,
                message:
                    'Airtel settlement scheduler disabled'
            });

            return false;
        }

        if (this.stopping) {

            throw createError(
                'Airtel settlement scheduler is stopping',
                'AIRTEL_SETTLEMENT_SCHEDULER_STOPPING'
            );

        }

        if (this.timer) {
            return true;
        }

        this.validateConfiguration();

        this.startedAt = new Date();

        this.timer = setInterval(
            () => {

                this.executeScheduledRun()
                    .catch(error => {

                        this.logger?.error?.({

                            component: COMPONENT,

                            provider: PROVIDER,

                            message:
                                'Unhandled Airtel scheduled settlement execution error',

                            error:
                                safeError(error)

                        });

                    });

            },
            this.intervalMs
        );

        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }

        this.logger?.info?.({

            component: COMPONENT,

            provider: PROVIDER,

            message:
                'Airtel settlement scheduler started',

            intervalMs:
                this.intervalMs,

            lockTtlMs:
                this.lockTtlMs,

            lockRenewIntervalMs:
                this.lockRenewIntervalMs,

            tenantTimeoutMs:
                this.tenantTimeoutMs,

            maxConcurrentRuns:
                this.maxConcurrentRuns

        });

        this.metrics?.counter?.(
            'payment_airtel_settlement_scheduler_started_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Stop Scheduler
     * =========================================================================
     *
     * Stops new scheduled work immediately.
     * Active financial workflows are allowed to complete naturally.
     */

    async stop({
        waitForActiveRuns = true,
        timeoutMs = 30_000
    } = {}) {

        this.stopping = true;

        if (this.timer) {

            clearInterval(this.timer);

            this.timer = null;

        }

        if (!waitForActiveRuns) {

            this.logger?.info?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Airtel settlement scheduler stopped without waiting for active runs',

                activeRuns:
                    this.runningCount

            });

            return true;
        }

        const deadline =
            Date.now() +
            normalizePositiveInteger(
                timeoutMs,
                30_000
            );

        while (
            this.runningCount > 0 &&
            Date.now() < deadline
        ) {

            await new Promise(resolve => {
                setTimeout(resolve, 100);
            });

        }

        const timedOut =
            this.runningCount > 0;

        this.logger?.info?.({

            component: COMPONENT,

            provider: PROVIDER,

            message:
                timedOut
                    ? 'Airtel settlement scheduler stop timed out while active runs remained'
                    : 'Airtel settlement scheduler stopped',

            activeRuns:
                this.runningCount

        });

        if (timedOut) {

            this.logger?.warn?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Active Airtel settlement workflows remain in progress after scheduler shutdown timeout',

                activeRuns:
                    this.runningCount

            });

        }

        return !timedOut;
    }

    /**
     * =========================================================================
     * Scheduled Execution
     * =========================================================================
     */

    async executeScheduledRun() {

        this.statistics.scheduledRuns++;

        return this.execute({

            trigger:
                TRIGGERS.SCHEDULED

        });
    }

    /**
     * =========================================================================
     * Manual Execution
     * =========================================================================
     */

    async executeNow(options = {}) {

        this.statistics.manualRuns++;

        return this.execute({

            trigger:
                TRIGGERS.MANUAL,

            ...options

        });
    }

    /**
     * =========================================================================
     * Execute Settlement Workflow
     * =========================================================================
     */

    async execute({

        trigger = TRIGGERS.MANUAL,

        settlementDate = new Date(),

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        idempotencyKey,

        requestedBy = null,

        tenantIds = null,

        metadata = {}

    } = {}) {

        if (!this.enabled) {

            this.statistics.skippedRuns++;

            return {

                success: false,

                skipped: true,

                status:
                    RUN_STATUS.SKIPPED,

                reason:
                    'Scheduler disabled'

            };
        }

        if (this.stopping) {

            this.statistics.skippedRuns++;

            return {

                success: false,

                skipped: true,

                status:
                    RUN_STATUS.STOPPING,

                reason:
                    'Scheduler is stopping'

            };
        }

        if (
            !Object.values(TRIGGERS)
                .includes(trigger)
        ) {
            throw createError(
                `Unsupported scheduler trigger: ${trigger}`,
                'AIRTEL_SETTLEMENT_INVALID_TRIGGER'
            );
        }

        const normalizedSettlementDate =
            normalizeDate(settlementDate);

        if (this.runningCount >= this.maxConcurrentRuns) {

            this.statistics.skippedRuns++;

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_skipped_concurrency_total',
                1
            );

            return {

                success: false,

                skipped: true,

                status:
                    RUN_STATUS.SKIPPED,

                reason:
                    'Execution concurrency limit reached',

                correlationId,

                executionId

            };
        }

        const effectiveIdempotencyKey =
            idempotencyKey ||
            this.buildRunIdempotencyKey({
                settlementDate:
                    normalizedSettlementDate,
                trigger
            });

        const span =
            this.startSpan({
                trigger,
                correlationId,
                executionId
            });

        const startedAt =
            new Date();

        const startedAtMs =
            Date.now();

        const lockKey =
            this.buildLockKey();

        let lock = null;
        let runCompleted = false;

        this.runningCount++;

        this.statistics.activeRuns =
            this.runningCount;

        this.statistics.lastRunStartedAt =
            startedAt;

        this.activeExecutions.set(
            executionId,
            {
                executionId,
                trigger,
                correlationId,
                settlementDate:
                    normalizedSettlementDate,
                startedAt,
                lockKey
            }
        );

        this.metrics?.counter?.(
            'payment_airtel_settlement_scheduler_execution_started_total',
            1
        );

        try {

            lock =
                await this.acquireLock(
                    lockKey,
                    {
                        correlationId,
                        executionId,
                        settlementDate:
                            normalizedSettlementDate,
                        trigger
                    }
                );

            if (!lock) {

                this.statistics.skippedRuns++;

                this.metrics?.counter?.(
                    'payment_airtel_settlement_scheduler_skipped_lock_total',
                    1
                );

                const result = {

                    success: false,

                    skipped: true,

                    status:
                        RUN_STATUS.SKIPPED,

                    reason:
                        'Distributed lock unavailable',

                    correlationId,

                    executionId

                };

                await this.recordSkippedRun({
                    result,
                    trigger,
                    settlementDate:
                        normalizedSettlementDate,
                    correlationId,
                    executionId
                });

                return result;
            }

            this.startLeaseRenewal(
                lock,
                {
                    executionId,
                    correlationId
                }
            );

            const tenants =
                await this.loadTenants({
                    tenantIds
                });

            const summaries = [];

            let successfulTenants = 0;
            let failedTenants = 0;

            for (const tenant of tenants) {

                const tenantId =
                    getTenantId(tenant);

                if (!tenantId) {

                    failedTenants++;

                    this.recordTenantFailure(
                        summaries,
                        {
                            tenantId: null,

                            error: {

                                name:
                                    'InvalidTenant',

                                message:
                                    'Active tenant record has no usable tenant identifier',

                                code:
                                    'AIRTEL_SETTLEMENT_INVALID_TENANT'

                            }
                        }
                    );

                    continue;
                }

                this.statistics.activeTenantExecutions++;

                this.statistics.totalTenantsProcessed++;

                try {

                    const tenantResult =
                        await this.executeTenant({
                            tenant,

                            tenantId,

                            trigger,

                            settlementDate:
                                normalizedSettlementDate,

                            correlationId,

                            executionId,

                            idempotencyKey:
                                effectiveIdempotencyKey,

                            requestedBy,

                            metadata

                        });

                    successfulTenants++;

                    summaries.push(
                        tenantResult
                    );

                    this.metrics?.counter?.(
                        'payment_airtel_settlement_scheduler_tenant_success_total',
                        1
                    );

                } catch (error) {

                    failedTenants++;

                    this.statistics.totalTenantFailures++;

                    this.recordTenantFailure(
                        summaries,
                        {
                            tenantId,
                            error:
                                safeError(error)
                        }
                    );

                    this.metrics?.counter?.(
                        'payment_airtel_settlement_scheduler_tenant_failure_total',
                        1
                    );

                    this.logger?.error?.({

                        component: COMPONENT,

                        provider: PROVIDER,

                        message:
                            'Airtel settlement tenant execution failed',

                        tenantId,

                        trigger,

                        correlationId,

                        executionId,

                        error:
                            safeError(error)

                    });

                    if (!this.continueOnTenantError) {
                        break;
                    }
                } finally {

                    this.statistics.activeTenantExecutions--;

                }
            }

            const status =
                failedTenants === 0
                    ? RUN_STATUS.SUCCESS
                    : successfulTenants > 0
                        ? RUN_STATUS.PARTIAL_FAILURE
                        : RUN_STATUS.FAILED;

            const result = {

                success:
                    failedTenants === 0,

                status,

                trigger,

                correlationId,

                executionId,

                settlementDate:
                    normalizedSettlementDate,

                processedTenants:
                    tenants.length,

                successfulTenants,

                failedTenants,

                summaries

            };

            await this.publishCompletionEvent({
                result,
                settlementDate:
                    normalizedSettlementDate,
                trigger
            });

            await this.recordCompletionAudit({
                result,
                settlementDate:
                    normalizedSettlementDate,
                trigger,
                requestedBy
            });

            if (status === RUN_STATUS.SUCCESS) {

                this.statistics.successfulRuns++;

                this.statistics.lastSuccessfulRunAt =
                    new Date();

                this.metrics?.counter?.(
                    'payment_airtel_settlement_scheduler_success_total',
                    1
                );

            } else if (
                status === RUN_STATUS.PARTIAL_FAILURE
            ) {

                this.statistics.partiallyFailedRuns++;

                this.metrics?.counter?.(
                    'payment_airtel_settlement_scheduler_partial_failure_total',
                    1
                );

            } else {

                this.statistics.failedRuns++;

                this.metrics?.counter?.(
                    'payment_airtel_settlement_scheduler_failure_total',
                    1
                );

            }

            this.metrics?.histogram?.(
                'payment_airtel_settlement_scheduler_duration_ms',
                Date.now() - startedAtMs
            );

            runCompleted = true;

            if (
                failedTenants > 0 &&
                this.failRunOnTenantError
            ) {

                const aggregateError =
                    createError(
                        `Airtel settlement scheduler completed with ${failedTenants} tenant failure(s)`,
                        'AIRTEL_SETTLEMENT_TENANT_FAILURE'
                    );

                aggregateError.result =
                    this.safeRunResult(result);

                throw aggregateError;
            }

            return result;

        } catch (error) {

            if (!runCompleted) {

                this.statistics.failedRuns++;

                this.statistics.lastFailure = {

                    at: new Date(),

                    message:
                        truncateString(
                            error?.message ||
                            String(error),
                            MAX_SAFE_ERROR_MESSAGE_LENGTH
                        ),

                    code:
                        truncateString(
                            error?.code,
                            128
                        )

                };

                this.metrics?.counter?.(
                    'payment_airtel_settlement_scheduler_failure_total',
                    1
                );

                this.metrics?.histogram?.(
                    'payment_airtel_settlement_scheduler_duration_ms',
                    Date.now() - startedAtMs
                );

                await this.recordFailureAudit({
                    trigger,
                    settlementDate:
                        normalizedSettlementDate,
                    correlationId,
                    executionId,
                    requestedBy,
                    error
                });

                await this.publishFailureEvent({
                    trigger,
                    settlementDate:
                        normalizedSettlementDate,
                    correlationId,
                    executionId,
                    error
                });

            }

            this.logger?.error?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Airtel settlement scheduler execution failed',

                trigger,

                correlationId,

                executionId,

                error:
                    safeError(error)

            });

            throw error;

        } finally {

            this.stopLeaseRenewal();

            await this.releaseLock(
                lock,
                {
                    executionId,
                    correlationId
                }
            );

            this.runningCount =
                Math.max(
                    0,
                    this.runningCount - 1
                );

            this.statistics.activeRuns =
                this.runningCount;

            this.statistics.lastRunCompletedAt =
                new Date();

            this.activeExecutions.delete(
                executionId
            );

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Tenant Execution
     * =========================================================================
     */

    async executeTenant({

        tenant,

        tenantId,

        trigger,

        settlementDate,

        correlationId,

        executionId,

        idempotencyKey,

        requestedBy,

        metadata

    }) {

        const tenantStartedAt =
            Date.now();

        const tenantSpan =
            this.startTenantSpan({
                tenantId,
                trigger,
                correlationId,
                executionId
            });

        try {

            const tenantContext = {

                provider:
                    PROVIDER,

                tenantId,

                trigger,

                settlementDate,

                correlationId,

                executionId,

                idempotencyKey:
                    this.buildTenantIdempotencyKey({
                        tenantId,
                        settlementDate,
                        idempotencyKey
                    }),

                requestedBy,

                metadata:
                    sanitizeValue(metadata),

                tenant:
                    this.safeTenantIdentity(
                        tenant
                    )

            };

            const settlement =
                await this.withTimeout(
                    this.executeSettlement(
                        tenantContext
                    ),
                    this.tenantTimeoutMs,
                    `Airtel settlement execution timed out for tenant ${tenantId}`
                );

            const reconciliation =
                await this.withTimeout(
                    this.executeReconciliation(
                        tenantContext,
                        settlement
                    ),
                    this.tenantTimeoutMs,
                    `Airtel settlement reconciliation timed out for tenant ${tenantId}`
                );

            const summary = {

                tenantId,

                success: true,

                settlement:
                    this.summarizeSettlement(
                        settlement
                    ),

                reconciliation:
                    this.summarizeReconciliation(
                        reconciliation
                    ),

                durationMs:
                    Date.now() - tenantStartedAt

            };

            return summary;

        } finally {

            tenantSpan?.end?.();
        }
    }

    /**
     * =========================================================================
     * Settlement Delegation
     * =========================================================================
     */

    async executeSettlement(context) {

        if (
            !this.settlementService ||
            typeof this.settlementService.process !== 'function'
        ) {

            throw createError(
                'Airtel SettlementService.process is not configured',
                'AIRTEL_SETTLEMENT_SERVICE_NOT_CONFIGURED'
            );

        }

        return this.settlementService.process({
            tenantId:
                context.tenantId,

            settlementDate:
                context.settlementDate,

            correlationId:
                context.correlationId,

            executionId:
                context.executionId,

            idempotencyKey:
                context.idempotencyKey,

            trigger:
                context.trigger,

            requestedBy:
                context.requestedBy,

            metadata:
                context.metadata
        });
    }

    /**
     * =========================================================================
     * Reconciliation Delegation
     * =========================================================================
     */

    async executeReconciliation(
        context,
        settlementResult
    ) {

        if (
            !this.settlementReconciler ||
            typeof this.settlementReconciler.reconcile !== 'function'
        ) {

            throw createError(
                'Airtel SettlementReconciler.reconcile is not configured',
                'AIRTEL_SETTLEMENT_RECONCILER_NOT_CONFIGURED'
            );

        }

        return this.settlementReconciler.reconcile({

            tenantId:
                context.tenantId,

            settlementDate:
                context.settlementDate,

            correlationId:
                context.correlationId,

            executionId:
                context.executionId,

            idempotencyKey:
                context.idempotencyKey,

            trigger:
                context.trigger,

            settlement:
                this.safeOperationalPayload(
                    settlementResult
                )

        });
    }

    /**
     * =========================================================================
     * Tenant Loader
     * =========================================================================
     */

    async loadTenants({
        tenantIds = null
    } = {}) {

        if (
            !this.tenantRepository ||
            typeof this.tenantRepository.findActive !== 'function'
        ) {

            throw createError(
                'Airtel settlement tenant repository is not configured',
                'AIRTEL_SETTLEMENT_TENANT_REPOSITORY_NOT_CONFIGURED'
            );

        }

        let tenants;

        if (
            Array.isArray(tenantIds) &&
            tenantIds.length > 0
        ) {

            const normalizedTenantIds =
                [
                    ...new Set(
                        tenantIds
                            .map(value => String(value).trim())
                            .filter(Boolean)
                    )
                ];

            if (
                typeof this.tenantRepository
                    .findActiveByIds === 'function'
            ) {

                tenants =
                    await this.tenantRepository
                        .findActiveByIds(
                            normalizedTenantIds
                        );

            } else {

                tenants =
                    await this.tenantRepository
                        .findActive({
                            tenantIds:
                                normalizedTenantIds
                        });

            }

        } else {

            tenants =
                await this.tenantRepository
                    .findActive();
        }

        if (!Array.isArray(tenants)) {

            throw createError(
                'Tenant repository returned an invalid collection',
                'AIRTEL_SETTLEMENT_INVALID_TENANT_RESULT'
            );
        }

        if (tenants.length > this.maxTenants) {

            throw createError(
                `Tenant execution limit exceeded: ${tenants.length} > ${this.maxTenants}`,
                'AIRTEL_SETTLEMENT_TENANT_LIMIT_EXCEEDED'
            );

        }

        const seenTenantIds =
            new Set();

        const normalizedTenants = [];

        for (const tenant of tenants) {

            const tenantId =
                getTenantId(tenant);

            if (!tenantId) {
                continue;
            }

            if (seenTenantIds.has(tenantId)) {

                this.logger?.warn?.({

                    component: COMPONENT,

                    provider: PROVIDER,

                    message:
                        'Duplicate tenant identifier returned by tenant repository; duplicate skipped',

                    tenantId

                });

                continue;
            }

            seenTenantIds.add(
                tenantId
            );

            normalizedTenants.push(
                tenant
            );
        }

        return normalizedTenants;
    }

    /**
     * =========================================================================
     * Distributed Lock
     * =========================================================================
     *
     * The scheduler never assumes one particular lock implementation.
     * Supported adapters may expose:
     *
     *   acquire({ key, ttl, ...context })
     *   release()
     *   renew({ ttl }) / extend({ ttl }) / refresh({ ttl })
     *
     * An adapter that does not exist is treated as a configuration failure
     * rather than silently disabling distributed safety.
     */

    buildLockKey() {

        return (
            process.env.AIRTEL_SETTLEMENT_SCHEDULER_LOCK_KEY ||
            'titech:airtel:settlement:scheduler'
        );
    }

    async acquireLock(
        key,
        context = {}
    ) {

        if (
            !this.distributedLock ||
            typeof this.distributedLock.acquire !== 'function'
        ) {

            throw createError(
                'Distributed settlement lock is not configured',
                'AIRTEL_SETTLEMENT_DISTRIBUTED_LOCK_NOT_CONFIGURED'
            );

        }

        const lock =
            await this.distributedLock.acquire({

                key,

                ttl:
                    this.lockTtlMs,

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                ...context

            });

        if (!lock) {
            return null;
        }

        return lock;
    }

    async releaseLock(
        lock,
        context = {}
    ) {

        if (!lock) {
            return;
        }

        try {

            if (
                typeof lock.release === 'function'
            ) {

                await lock.release();

                return;
            }

            if (
                typeof this.distributedLock?.release ===
                'function'
            ) {

                await this.distributedLock.release({
                    lock,
                    ...context
                });

                return;
            }

            this.logger?.warn?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Distributed lock acquired but no release operation was available',

                executionId:
                    context.executionId

            });

        } catch (error) {

            this.logger?.warn?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to release Airtel settlement scheduler lock',

                executionId:
                    context.executionId,

                error:
                    safeError(error)

            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_lock_release_failure_total',
                1
            );

        }
    }

    /**
     * =========================================================================
     * Lease Renewal
     * =========================================================================
     */

    startLeaseRenewal(
        lock,
        context = {}
    ) {

        this.stopLeaseRenewal();

        if (!lock) {
            return;
        }

        const renew =
            async () => {

                try {

                    let renewed = false;

                    if (
                        typeof lock.renew === 'function'
                    ) {

                        await lock.renew({
                            ttl:
                                this.lockTtlMs
                        });

                        renewed = true;

                    } else if (
                        typeof lock.extend === 'function'
                    ) {

                        await lock.extend({
                            ttl:
                                this.lockTtlMs
                        });

                        renewed = true;

                    } else if (
                        typeof lock.refresh === 'function'
                    ) {

                        await lock.refresh({
                            ttl:
                                this.lockTtlMs
                        });

                        renewed = true;

                    } else if (
                        typeof this.distributedLock?.renew ===
                        'function'
                    ) {

                        await this.distributedLock.renew({
                            lock,
                            ttl:
                                this.lockTtlMs,
                            ...context
                        });

                        renewed = true;

                    } else if (
                        typeof this.distributedLock?.extend ===
                        'function'
                    ) {

                        await this.distributedLock.extend({
                            lock,
                            ttl:
                                this.lockTtlMs,
                            ...context
                        });

                        renewed = true;
                    }

                    if (renewed) {

                        this.metrics?.counter?.(
                            'payment_airtel_settlement_scheduler_lock_renewal_total',
                            1
                        );

                    } else {

                        this.stopLeaseRenewal();

                        this.logger?.warn?.({

                            component: COMPONENT,

                            provider: PROVIDER,

                            message:
                                'Distributed lock implementation does not support lease renewal; scheduler will retain the original lease',

                            executionId:
                                context.executionId

                        });

                    }

                } catch (error) {

                    this.logger?.error?.({

                        component: COMPONENT,

                        provider: PROVIDER,

                        message:
                            'Airtel settlement scheduler lock renewal failed',

                        executionId:
                            context.executionId,

                        error:
                            safeError(error)

                    });

                    this.metrics?.counter?.(
                        'payment_airtel_settlement_scheduler_lock_renewal_failure_total',
                        1
                    );

                    /*
                     * Do not blindly release the lock after a renewal failure.
                     * The lock adapter remains the authority over ownership.
                     * Subsequent execution safety therefore remains delegated
                     * to the distributed lock implementation.
                     */

                }
            };

        const renewalInterval =
            Math.max(
                1_000,
                this.lockRenewIntervalMs
            );

        this.leaseRenewTimer =
            setInterval(
                () => {

                    renew()
                        .catch(error => {

                            this.logger?.error?.({

                                component: COMPONENT,

                                provider: PROVIDER,

                                message:
                                    'Unhandled Airtel settlement lock renewal error',

                                executionId:
                                    context.executionId,

                                error:
                                    safeError(error)

                            });

                        });

                },
                renewalInterval
            );

        if (
            typeof this.leaseRenewTimer.unref ===
            'function'
        ) {

            this.leaseRenewTimer.unref();
        }
    }

    stopLeaseRenewal() {

        if (this.leaseRenewTimer) {

            clearInterval(
                this.leaseRenewTimer
            );

            this.leaseRenewTimer = null;
        }
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    buildRunIdempotencyKey({
        settlementDate,
        trigger
    }) {

        const day =
            settlementDate
                .toISOString()
                .slice(0, 10);

        return (
            `airtel:settlement:scheduler:${day}:${trigger}`
        );
    }

    buildTenantIdempotencyKey({
        tenantId,
        settlementDate,
        idempotencyKey
    }) {

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    `${tenantId}:${settlementDate.toISOString()}:${idempotencyKey}`
                )
                .digest('hex');

        return (
            `airtel:settlement:${tenantId}:${digest}`
        );
    }

    /**
     * =========================================================================
     * Event Publication
     * =========================================================================
     *
     * Publication is operational only. No provider raw response or financial
     * credentials are placed into the event payload.
     */

    async publishCompletionEvent({
        result,
        settlementDate,
        trigger
    }) {

        const payload = {

            status:
                result.status,

            trigger,

            settlementDate:
                settlementDate.toISOString(),

            correlationId:
                result.correlationId,

            executionId:
                result.executionId,

            processedTenants:
                result.processedTenants,

            successfulTenants:
                result.successfulTenants,

            failedTenants:
                result.failedTenants

        };

        const event = {

            type:
                'AIRTEL_SETTLEMENT_COMPLETED',

            provider:
                PROVIDER,

            version:
                '1.0',

            occurredAt:
                new Date().toISOString(),

            correlationId:
                result.correlationId,

            executionId:
                result.executionId,

            payload

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

                    component: COMPONENT,

                    provider: PROVIDER,

                    message:
                        'No Airtel settlement event publisher is configured',

                    executionId:
                        result.executionId

                });

                return false;
            }

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_event_published_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_event_publish_failure_total',
                1
            );

            /*
             * Event publication failure must not rewrite the authoritative
             * settlement/reconciliation result. Operational visibility is
             * logged and measured separately.
             */

            this.logger?.error?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to publish Airtel settlement completion event',

                executionId:
                    result.executionId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    async publishFailureEvent({
        trigger,
        settlementDate,
        correlationId,
        executionId,
        error
    }) {

        const event = {

            type:
                'AIRTEL_SETTLEMENT_SCHEDULER_FAILED',

            provider:
                PROVIDER,

            version:
                '1.0',

            occurredAt:
                new Date().toISOString(),

            correlationId,

            executionId,

            payload: {

                trigger,

                settlementDate:
                    settlementDate.toISOString(),

                error: {
                    name:
                        truncateString(
                            error?.name,
                            128
                        ),
                    code:
                        truncateString(
                            error?.code,
                            128
                        )
                }

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

                return false;
            }

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_failure_event_published_total',
                1
            );

            return true;

        } catch (publishError) {

            this.logger?.error?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to publish Airtel settlement scheduler failure event',

                executionId,

                error:
                    safeError(publishError)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordCompletionAudit({
        result,
        settlementDate,
        trigger,
        requestedBy
    }) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        const auditRecord = {

            action:
                result.status === RUN_STATUS.SUCCESS
                    ? 'AIRTEL_SETTLEMENT_JOB_COMPLETED'
                    : 'AIRTEL_SETTLEMENT_JOB_COMPLETED_WITH_ERRORS',

            provider:
                PROVIDER,

            component:
                COMPONENT,

            trigger,

            settlementDate:
                settlementDate.toISOString(),

            correlationId:
                result.correlationId,

            executionId:
                result.executionId,

            requestedBy:
                this.safeActor(requestedBy),

            processedTenants:
                result.processedTenants,

            successfulTenants:
                result.successfulTenants,

            failedTenants:
                result.failedTenants,

            status:
                result.status

        };

        try {

            await this.auditService.record(
                auditRecord
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_audit_success_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_audit_failure_total',
                1
            );

            this.logger?.error?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to record Airtel settlement scheduler completion audit',

                executionId:
                    result.executionId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    async recordFailureAudit({
        trigger,
        settlementDate,
        correlationId,
        executionId,
        requestedBy,
        error
    }) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        try {

            await this.auditService.record({

                action:
                    'AIRTEL_SETTLEMENT_JOB_FAILED',

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                trigger,

                settlementDate:
                    settlementDate.toISOString(),

                correlationId,

                executionId,

                requestedBy:
                    this.safeActor(
                        requestedBy
                    ),

                error: {

                    name:
                        truncateString(
                            error?.name,
                            128
                        ),

                    code:
                        truncateString(
                            error?.code,
                            128
                        ),

                    message:
                        truncateString(
                            error?.message,
                            MAX_SAFE_ERROR_MESSAGE_LENGTH
                        )

                }

            });

            return true;

        } catch (auditError) {

            this.logger?.error?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to record Airtel settlement scheduler failure audit',

                executionId,

                error:
                    safeError(auditError)

            });

            return false;
        }
    }

    async recordSkippedRun({
        result,
        trigger,
        settlementDate,
        correlationId,
        executionId
    }) {

        this.logger?.warn?.({

            component: COMPONENT,

            provider: PROVIDER,

            message:
                'Airtel settlement scheduler execution skipped',

            trigger,

            settlementDate:
                settlementDate.toISOString(),

            correlationId,

            executionId,

            reason:
                result.reason

        });

        return true;
    }

    /**
     * =========================================================================
     * Tenant Failure Recording
     * =========================================================================
     */

    recordTenantFailure(
        summaries,
        {
            tenantId,
            error
        }
    ) {

        if (
            summaries.length >=
            this.maxFailureDetails
        ) {
            return;
        }

        summaries.push({

            tenantId,

            success: false,

            error:
                safeError(error)

        });
    }

    /**
     * =========================================================================
     * Result Safety / Projection
     * =========================================================================
     */

    summarizeSettlement(settlement) {

        if (
            settlement === null ||
            settlement === undefined
        ) {
            return null;
        }

        if (
            typeof settlement !== 'object'
        ) {
            return truncateString(
                settlement
            );
        }

        const candidate = {

            status:
                settlement.status ??
                settlement.state,

            settlementId:
                settlement.settlementId ??
                settlement.id,

            reference:
                settlement.reference ??
                settlement.providerReference ??
                settlement.transactionReference,

            providerReference:
                settlement.providerReference,

            reconciliationStatus:
                settlement.reconciliationStatus,

            success:
                settlement.success,

            accepted:
                settlement.accepted,

            completedAt:
                settlement.completedAt,

            createdAt:
                settlement.createdAt

        };

        return sanitizeValue(
            candidate
        );
    }

    summarizeReconciliation(
        reconciliation
    ) {

        if (
            reconciliation === null ||
            reconciliation === undefined
        ) {
            return null;
        }

        if (
            typeof reconciliation !== 'object'
        ) {
            return truncateString(
                reconciliation
            );
        }

        const statistics =
            reconciliation.statistics ||
            {};

        const candidate = {

            status:
                reconciliation.status,

            resultStatus:
                reconciliation.resultStatus,

            reconciliationId:
                reconciliation.reconciliationId ??
                reconciliation.id,

            matched:
                reconciliation.matched ??
                statistics.matched,

            variance:
                reconciliation.variance ??
                statistics.variance,

            missingProvider:
                reconciliation.missingProvider ??
                statistics.missingProvider,

            missingLedger:
                reconciliation.missingLedger ??
                statistics.missingLedger,

            duplicateProvider:
                reconciliation.duplicateProvider ??
                statistics.duplicateProvider,

            duplicateLedger:
                reconciliation.duplicateLedger ??
                statistics.duplicateLedger,

            requiresReview:
                reconciliation.requiresReview,

            completedAt:
                reconciliation.completedAt

        };

        return sanitizeValue(
            candidate
        );
    }

    safeRunResult(result) {

        return {

            success:
                Boolean(result?.success),

            status:
                result?.status,

            trigger:
                result?.trigger,

            correlationId:
                result?.correlationId,

            executionId:
                result?.executionId,

            settlementDate:
                result?.settlementDate instanceof Date
                    ? result.settlementDate.toISOString()
                    : result?.settlementDate,

            processedTenants:
                result?.processedTenants || 0,

            successfulTenants:
                result?.successfulTenants || 0,

            failedTenants:
                result?.failedTenants || 0,

            summaries:
                Array.isArray(result?.summaries)
                    ? result.summaries
                        .slice(
                            0,
                            this.maxFailureDetails
                        )
                        .map(
                            summary =>
                                sanitizeValue(
                                    summary
                                )
                        )
                    : []

        };
    }

    safeOperationalPayload(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        if (
            typeof value !== 'object'
        ) {
            return truncateString(
                value
            );
        }

        return sanitizeValue(
            value
        );
    }

    safeTenantIdentity(
        tenant
    ) {

        if (!tenant) {
            return null;
        }

        return sanitizeValue({

            tenantId:
                getTenantId(tenant),

            status:
                tenant.status,

            code:
                tenant.code,

            name:
                tenant.name

        });
    }

    safeActor(
        actor
    ) {

        if (
            actor === null ||
            actor === undefined
        ) {
            return null;
        }

        if (
            typeof actor !== 'object'
        ) {
            return truncateString(
                actor,
                128
            );
        }

        return sanitizeValue({

            id:
                actor.id ??
                actor.userId ??
                actor.actorId,

            type:
                actor.type,

            role:
                actor.role

        });
    }

    /**
     * =========================================================================
     * Timeout Boundary
     * =========================================================================
     */

    async withTimeout(
        promise,
        timeoutMs,
        message
    ) {

        const normalizedTimeout =
            normalizePositiveInteger(
                timeoutMs,
                this.tenantTimeoutMs
            );

        let timer = null;

        const timeoutPromise =
            new Promise((_, reject) => {

                timer = setTimeout(() => {

                    const error =
                        createError(
                            message,
                            'AIRTEL_SETTLEMENT_TENANT_TIMEOUT'
                        );

                    reject(error);

                }, normalizedTimeout);

                if (
                    typeof timer.unref ===
                    'function'
                ) {
                    timer.unref();
                }

            });

        try {

            return await Promise.race([
                promise,
                timeoutPromise
            ]);

        } finally {

            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan({
        trigger,
        correlationId,
        executionId
    }) {

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
                    'airtel.settlement.scheduler'
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'component',
                COMPONENT
            );

            span?.setAttribute?.(
                'trigger',
                trigger
            );

            span?.setAttribute?.(
                'correlation_id',
                correlationId
            );

            span?.setAttribute?.(
                'execution_id',
                executionId
            );

            return span;

        } catch (error) {

            this.logger?.warn?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to start Airtel settlement scheduler trace span',

                executionId,

                error:
                    safeError(error)

            });

            return null;
        }
    }

    startTenantSpan({
        tenantId,
        trigger,
        correlationId,
        executionId
    }) {

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
                    'airtel.settlement.scheduler.tenant'
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'tenant_id',
                tenantId
            );

            span?.setAttribute?.(
                'trigger',
                trigger
            );

            span?.setAttribute?.(
                'correlation_id',
                correlationId
            );

            span?.setAttribute?.(
                'execution_id',
                executionId
            );

            return span;

        } catch (error) {

            this.logger?.warn?.({

                component: COMPONENT,

                provider: PROVIDER,

                message:
                    'Failed to start Airtel tenant settlement trace span',

                tenantId,

                executionId,

                error:
                    safeError(error)

            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            enabled:
                this.enabled,

            stopping:
                this.stopping,

            running:
                this.runningCount > 0,

            runningCount:
                this.runningCount,

            intervalMs:
                this.intervalMs,

            lockTtlMs:
                this.lockTtlMs,

            lockRenewIntervalMs:
                this.lockRenewIntervalMs,

            tenantTimeoutMs:
                this.tenantTimeoutMs,

            maxConcurrentRuns:
                this.maxConcurrentRuns,

            maxTenants:
                this.maxTenants,

            uptimeMs:
                this.startedAt
                    ? Math.max(
                        0,
                        Date.now() -
                        this.startedAt.getTime()
                    )
                    : 0

        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const dependencies = {

            settlementService:
                Boolean(
                    this.settlementService &&
                    typeof this.settlementService.process ===
                    'function'
                ),

            settlementReconciler:
                Boolean(
                    this.settlementReconciler &&
                    typeof this.settlementReconciler.reconcile ===
                    'function'
                ),

            tenantRepository:
                Boolean(
                    this.tenantRepository &&
                    typeof this.tenantRepository.findActive ===
                    'function'
                ),

            distributedLock:
                Boolean(
                    this.distributedLock &&
                    typeof this.distributedLock.acquire ===
                    'function'
                ),

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

            auditService:
                !this.auditService ||
                typeof this.auditService.record ===
                'function'

        };

        const dependencyValues =
            Object.values(
                dependencies
            );

        const allDependenciesAvailable =
            dependencyValues.every(Boolean);

        let status = 'UP';

        if (!this.enabled) {

            status =
                'DISABLED';

        } else if (this.stopping) {

            status =
                'STOPPING';

        } else if (
            !allDependenciesAvailable
        ) {

            status =
                'DEGRADED';

        } else if (
            this.runningCount >
            this.maxConcurrentRuns
        ) {

            status =
                'DEGRADED';
        }

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            status,

            enabled:
                this.enabled,

            stopping:
                this.stopping,

            running:
                this.runningCount > 0,

            runningCount:
                this.runningCount,

            timerActive:
                Boolean(this.timer),

            leaseRenewalActive:
                Boolean(this.leaseRenewTimer),

            intervalMs:
                this.intervalMs,

            lockTtlMs:
                this.lockTtlMs,

            lockRenewIntervalMs:
                this.lockRenewIntervalMs,

            tenantTimeoutMs:
                this.tenantTimeoutMs,

            maxConcurrentRuns:
                this.maxConcurrentRuns,

            startedAt:
                this.startedAt,

            dependencies,

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
                '1.0',

            enabled:
                this.enabled,

            stopping:
                this.stopping,

            timerActive:
                Boolean(this.timer),

            leaseRenewalActive:
                Boolean(this.leaseRenewTimer),

            activeExecutions:
                this.activeExecutions.size,

            configuration: {

                intervalMs:
                    this.intervalMs,

                lockTtlMs:
                    this.lockTtlMs,

                lockRenewIntervalMs:
                    this.lockRenewIntervalMs,

                tenantTimeoutMs:
                    this.tenantTimeoutMs,

                maxConcurrentRuns:
                    this.maxConcurrentRuns,

                maxTenants:
                    this.maxTenants,

                failRunOnTenantError:
                    this.failRunOnTenantError,

                continueOnTenantError:
                    this.continueOnTenantError

            },

            statistics:
                this.stats()

        };
    }
}

module.exports = SettlementScheduler;
module.exports.SettlementScheduler =
    SettlementScheduler;

module.exports.PROVIDER =
    PROVIDER;

module.exports.COMPONENT =
    COMPONENT;

module.exports.TRIGGERS =
    TRIGGERS;

module.exports.RUN_STATUS =
    RUN_STATUS;