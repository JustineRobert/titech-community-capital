'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Authentication Health Monitor
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/healthMonitor.js
 *
 * Purpose
 * -------
 * Production-grade health orchestration for the Airtel Money authentication
 * subsystem.
 *
 * Responsibilities
 * ----------------
 * • Authentication subsystem monitoring
 * • Configuration validation
 * • Credential subsystem validation
 * • Token cache health analysis
 * • OAuth dependency health
 * • Authentication service health
 * • Kubernetes readiness
 * • Kubernetes liveness
 * • Startup diagnostics
 * • Dependency aggregation
 * • SLA / latency monitoring hooks
 * • Metrics publication
 * • Structured logging
 * • Event publishing
 * • OpenTelemetry tracing
 * • Alert integration
 * • Failure tracking
 * • Health transition detection
 * • Alert storm protection
 * • Stale-health detection
 * • Concurrent probe protection
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Authentication execution
 * • OAuth transport
 * • Token issuance
 * • Credential storage
 * • Payment processing
 *
 * Security
 * --------
 * • Never returns credentials.
 * • Never returns access tokens.
 * • Never returns client secrets.
 * • Never returns authorization headers.
 * • Provider errors are sanitized.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../../shared/errors');

/**
 * ============================================================================
 * Provider
 * ============================================================================
 */

const PROVIDER = 'AIRTEL';

const COMPONENT = 'authentication';

const SERVICE_NAME = 'airtel-auth';

/**
 * ============================================================================
 * Health statuses
 * ============================================================================
 */

const HEALTH_STATUS = Object.freeze({

    UP: 'UP',

    DOWN: 'DOWN',

    DEGRADED: 'DEGRADED',

    UNKNOWN: 'UNKNOWN'

});

/**
 * ============================================================================
 * Probe types
 * ============================================================================
 */

const PROBE_TYPES = Object.freeze({

    FULL: 'full',

    READINESS: 'readiness',

    LIVENESS: 'liveness',

    STARTUP: 'startup'

});

/**
 * ============================================================================
 * Default operational policy
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    /**
     * Maximum age before a previously successful health assessment is
     * considered stale.
     */
    HEALTH_STALE_AFTER_MS: 30000,

    /**
     * Alert suppression window.
     */
    ALERT_COOLDOWN_MS: 60000,

    /**
     * Maximum number of consecutive failures before an alert becomes
     * actionable.
     */
    ALERT_FAILURE_THRESHOLD: 3,

    /**
     * Maximum amount of error text retained in operational diagnostics.
     */
    MAX_ERROR_LENGTH: 500,

    /**
     * Maximum tenant identifier length.
     */
    MAX_TENANT_ID_LENGTH: 128,

    /**
     * Health probes should never become infinite operations.
     */
    PROBE_TIMEOUT_MS: 5000,

    /**
     * Authentication service itself is not required for liveness.
     */
    LIVENESS_REQUIRES_AUTH: false,

    /**
     * Credential validation is required for readiness when a tenant is
     * explicitly supplied.
     */
    READINESS_REQUIRES_CREDENTIALS: true,

    /**
     * OAuth dependency is required for readiness.
     */
    READINESS_REQUIRES_OAUTH: true,

    /**
     * Token manager is required for readiness.
     */
    READINESS_REQUIRES_TOKEN_MANAGER: true,

    /**
     * Configuration is always required.
     */
    READINESS_REQUIRES_CONFIGURATION: true

});

/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

/**
 * Safely truncate an error/message.
 */
function safeErrorMessage(error) {

    if (!error) {

        return 'Unknown error';

    }

    const message =

        error.message ||

        String(error);

    return String(message)

        .replace(/client[_-]?secret/gi, '[REDACTED]')

        .replace(/access[_-]?token/gi, '[REDACTED]')

        .replace(/refresh[_-]?token/gi, '[REDACTED]')

        .replace(/authorization/gi, '[REDACTED]')

        .replace(/password/gi, '[REDACTED]')

        .replace(/secret/gi, '[REDACTED]')

        .substring(

            0,

            DEFAULTS.MAX_ERROR_LENGTH

        );

}

/**
 * Safe status extraction.
 */
function normalizeStatus(result) {

    if (!result || typeof result !== 'object') {

        return HEALTH_STATUS.UNKNOWN;

    }

    const status =

        String(result.status || '')

            .trim()

            .toUpperCase();

    if (

        status === HEALTH_STATUS.UP ||

        status === HEALTH_STATUS.DOWN ||

        status === HEALTH_STATUS.DEGRADED ||

        status === HEALTH_STATUS.UNKNOWN

    ) {

        return status;

    }

    return HEALTH_STATUS.UNKNOWN;

}

/**
 * Remove unsafe fields from dependency health responses.
 */
function sanitizeHealthResult(result) {

    if (!result || typeof result !== 'object') {

        return {

            status: HEALTH_STATUS.UNKNOWN

        };

    }

    const sanitized = {

        status: normalizeStatus(result)

    };

    const safeFields = [

        'cacheEntries',

        'runtimeOverrides',

        'cacheTTL',

        'uptimeMs',

        'initialized',

        'provider',

        'component',

        'statistics'

    ];

    for (const field of safeFields) {

        if (

            Object.prototype.hasOwnProperty.call(

                result,

                field

            )

        ) {

            sanitized[field] = result[field];

        }

    }

    if (result.error) {

        sanitized.error =

            safeErrorMessage(result.error);

    }

    return sanitized;

}

/**
 * Promise timeout wrapper.
 */
async function withTimeout(

    promise,

    timeoutMs,

    label

) {

    const timeout =

        Number(timeoutMs) > 0

            ? Number(timeoutMs)

            : DEFAULTS.PROBE_TIMEOUT_MS;

    let timer;

    try {

        return await Promise.race([

            promise,

            new Promise((_, reject) => {

                timer = setTimeout(() => {

                    const error =

                        new Error(

                            `${label} health check timed out`

                        );

                    error.code =

                        'HEALTH_CHECK_TIMEOUT';

                    reject(error);

                }, timeout);

            })

        ]);

    }

    finally {

        if (timer) {

            clearTimeout(timer);

        }

    }

}

/**
 * ============================================================================
 * Health Monitor
 * ============================================================================
 */

class HealthMonitor {

    constructor({

        authService = null,

        oauthClient = null,

        tokenManager = null,

        credentialManager = null,

        configuration = null,

        logger = null,

        metrics = null,

        tracer = null,

        eventBus = null,

        alertService = null,

        options = {}

    } = {}) {

        this.authService = authService;

        this.oauthClient = oauthClient;

        this.tokenManager = tokenManager;

        this.credentialManager = credentialManager;

        this.configuration = configuration;

        this.logger = logger;

        this.metrics = metrics;

        this.tracer = tracer;

        this.eventBus = eventBus;

        this.alertService = alertService;

        this.options = Object.freeze({

            ...DEFAULTS,

            ...(options || {})

        });

        this.startedAt = new Date();

        this.lastHealthCheck = null;

        this.lastSuccessfulCheck = null;

        this.lastStatus = HEALTH_STATUS.UNKNOWN;

        this.lastAlertAt = null;

        this.lastAlertStatus = null;

        this.failureCount = 0;

        this.consecutiveSuccesses = 0;

        this.initialized = false;

        this.checkInProgress = false;

        this.statistics = {

            checks: 0,

            successful: 0,

            failed: 0,

            degraded: 0,

            unknown: 0,

            timeouts: 0,

            alerts: 0,

            suppressedAlerts: 0,

            statusTransitions: 0

        };

    }

    /**
     * ========================================================================
     * Initialize
     * ========================================================================
     */

    initialize() {

        this.initialized = true;

        this.startedAt = new Date();

        this.lastStatus = HEALTH_STATUS.UNKNOWN;

        this.logger?.info?.({

            message:

                'Airtel authentication health monitor initialized',

            provider: PROVIDER,

            component: COMPONENT

        });

        this.metrics?.counter?.(

            'payment_airtel_auth_health_monitor_initialized_total'

        );

        return true;

    }

    /**
     * ========================================================================
     * Full Authentication Health Assessment
     * ========================================================================
     */

    async check({

        tenantId = null,

        correlationId = crypto.randomUUID(),

        force = false

    } = {}) {

        if (

            this.checkInProgress &&

            !force &&

            this.lastHealthCheck

        ) {

            return {

                ...this.lastHealthCheck,

                reused: true,

                correlationId

            };

        }

        const span =

            this.tracer?.startSpan?.(

                'airtel.auth.health.check'

            );

        const started = Date.now();

        this.statistics.checks++;

        this.checkInProgress = true;

        try {

            const checks = await withTimeout(

                Promise.all({

                    configuration:

                        this.checkConfiguration(),

                    credentials:

                        this.checkCredentials(

                            tenantId

                        ),

                    tokenManager:

                        this.checkTokenManager(),

                    oauth:

                        this.checkOAuth(),

                    authentication:

                        this.checkAuthentication()

                }),

                this.options.PROBE_TIMEOUT_MS,

                'Airtel authentication health'

            );

            const durationMs =

                Date.now() - started;

            const status =

                this.calculateStatus(

                    checks,

                    PROBE_TYPES.FULL

                );

            const timestamp = new Date();

            const report = {

                provider: PROVIDER,

                component: COMPONENT,

                status,

                timestamp,

                correlationId,

                probe: PROBE_TYPES.FULL,

                initialized: this.initialized,

                uptimeMs:

                    Date.now() -

                    this.startedAt.getTime(),

                durationMs,

                checks,

                failureCount:

                    this.failureCount,

                stale: false

            };

            this.recordResult(report);

            this.publishMetrics(report);

            this.publishTransitionIfNeeded(report);

            this.publishEvent(report);

            if (

                status !== HEALTH_STATUS.UP

            ) {

                await this.triggerAlert(

                    report

                );

            }

            this.logger?.info?.({

                message:

                    'Airtel authentication health assessment completed',

                provider: PROVIDER,

                component: COMPONENT,

                status,

                durationMs,

                correlationId

            });

            return report;

        }

        catch (error) {

            const durationMs =

                Date.now() - started;

            const normalized =

                normalizeError(error);

            if (

                error?.code ===

                'HEALTH_CHECK_TIMEOUT'

            ) {

                this.statistics.timeouts++;

            }

            const report = {

                provider: PROVIDER,

                component: COMPONENT,

                status: HEALTH_STATUS.DOWN,

                timestamp: new Date(),

                correlationId,

                probe: PROBE_TYPES.FULL,

                initialized: this.initialized,

                uptimeMs:

                    Date.now() -

                    this.startedAt.getTime(),

                durationMs,

                checks: {},

                failureCount:

                    this.failureCount + 1,

                error:

                    safeErrorMessage(

                        normalized

                    ),

                stale: false

            };

            this.recordResult(report);

            this.publishMetrics(report);

            this.publishTransitionIfNeeded(report);

            this.publishEvent(report);

            await this.triggerAlert(report);

            this.logger?.error?.({

                message:

                    'Airtel authentication health evaluation failed',

                provider: PROVIDER,

                component: COMPONENT,

                correlationId,

                durationMs,

                error:

                    safeErrorMessage(

                        normalized

                    )

            });

            return report;

        }

        finally {

            this.checkInProgress = false;

            span?.end?.();

        }

    }

    /**
     * ========================================================================
     * Kubernetes Readiness Probe
     * ========================================================================
     *
     * Readiness must answer:
     *
     * "Can this application safely serve Airtel authentication traffic?"
     *
     * It deliberately does NOT perform a real OAuth token acquisition.
     */

    async readiness({

        tenantId = null,

        correlationId = crypto.randomUUID()

    } = {}) {

        const span =

            this.tracer?.startSpan?.(

                'airtel.auth.health.readiness'

            );

        try {

            const checks = {

                configuration:

                    await this.checkConfiguration(),

                credentials:

                    this.options

                        .READINESS_REQUIRES_CREDENTIALS

                        ? await this.checkCredentials(

                            tenantId

                        )

                        : {

                            status:

                                HEALTH_STATUS.UNKNOWN

                        },

                tokenManager:

                    this.options

                        .READINESS_REQUIRES_TOKEN_MANAGER

                        ? await this.checkTokenManager()

                        : {

                            status:

                                HEALTH_STATUS.UNKNOWN

                        },

                oauth:

                    this.options

                        .READINESS_REQUIRES_OAUTH

                        ? await this.checkOAuth()

                        : {

                            status:

                                HEALTH_STATUS.UNKNOWN

                        }

            };

            const status =

                this.calculateStatus(

                    checks,

                    PROBE_TYPES.READINESS

                );

            const ready =

                status === HEALTH_STATUS.UP;

            this.metrics?.gauge?.(

                'payment_airtel_auth_readiness',

                ready ? 1 : 0

            );

            return {

                ready,

                status,

                provider: PROVIDER,

                component: COMPONENT,

                probe: PROBE_TYPES.READINESS,

                correlationId,

                timestamp: new Date(),

                checks

            };

        }

        catch (error) {

            this.metrics?.gauge?.(

                'payment_airtel_auth_readiness',

                0

            );

            return {

                ready: false,

                status: HEALTH_STATUS.DOWN,

                provider: PROVIDER,

                component: COMPONENT,

                probe: PROBE_TYPES.READINESS,

                correlationId,

                timestamp: new Date(),

                error:

                    safeErrorMessage(error)

            };

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ========================================================================
     * Kubernetes Liveness Probe
     * ========================================================================
     *
     * Liveness deliberately does not call the provider.
     *
     * A temporary Airtel outage must NOT cause Kubernetes to continuously
     * restart the application.
     */

    async liveness({

        correlationId = crypto.randomUUID()

    } = {}) {

        const uptimeMs =

            Date.now() -

            this.startedAt.getTime();

        const alive =

            this.initialized !== false;

        this.metrics?.gauge?.(

            'payment_airtel_auth_liveness',

            alive ? 1 : 0

        );

        return {

            alive,

            status:

                alive

                    ? HEALTH_STATUS.UP

                    : HEALTH_STATUS.DOWN,

            provider: PROVIDER,

            component: COMPONENT,

            probe: PROBE_TYPES.LIVENESS,

            initialized: this.initialized,

            uptimeMs,

            timestamp: new Date(),

            correlationId

        };

    }

    /**
     * ========================================================================
     * Startup Probe
     * ========================================================================
     */

    async startup({

        correlationId = crypto.randomUUID(),

        tenantId = null

    } = {}) {

        const configuration =

            await this.checkConfiguration();

        const tokenManager =

            await this.checkTokenManager();

        const oauth =

            await this.checkOAuth();

        const credentials =

            tenantId

                ? await this.checkCredentials(

                    tenantId

                )

                : {

                    status:

                        HEALTH_STATUS.UNKNOWN,

                    skipped: true

                };

        const checks = {

            configuration,

            tokenManager,

            oauth,

            credentials

        };

        const status =

            this.calculateStatus(

                checks,

                PROBE_TYPES.STARTUP

            );

        const ready =

            status === HEALTH_STATUS.UP ||

            (

                status ===

                    HEALTH_STATUS.DEGRADED &&

                !this.hasCriticalStartupFailure(

                    checks

                )

            );

        return {

            ready,

            status,

            provider: PROVIDER,

            component: COMPONENT,

            probe: PROBE_TYPES.STARTUP,

            correlationId,

            timestamp: new Date(),

            uptimeMs:

                Date.now() -

                this.startedAt.getTime(),

            checks

        };

    }

    /**
     * ========================================================================
     * Configuration Check
     * ========================================================================
     */

    async checkConfiguration() {

        if (!this.configuration) {

            return {

                status: HEALTH_STATUS.DOWN,

                error:

                    'Airtel configuration dependency unavailable'

            };

        }

        try {

            const result =

                this.configuration.validate?.();

            if (

                result &&

                typeof result === 'object'

            ) {

                if (

                    result.valid === false

                ) {

                    return {

                        status:

                            HEALTH_STATUS.DOWN,

                        errors:

                            Array.isArray(

                                result.errors

                            )

                                ? result.errors

                                    .map(item => ({

                                        code:

                                            item?.code,

                                        message:

                                            safeErrorMessage(

                                                item?.message

                                            )

                                    }))

                                : []

                    };

                }

                if (

                    result.valid === true

                ) {

                    return {

                        status:

                            HEALTH_STATUS.UP

                    };

                }

            }

            return {

                status:

                    HEALTH_STATUS.UP

            };

        }

        catch (error) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    safeErrorMessage(error)

            };

        }

    }

    /**
     * ========================================================================
     * Credential Check
     * ========================================================================
     */

    async checkCredentials(

        tenantId = null

    ) {

        if (!this.credentialManager) {

            return {

                status:

                    HEALTH_STATUS.UNKNOWN,

                reason:

                    'Credential manager unavailable'

            };

        }

        try {

            if (!tenantId) {

                return {

                    status:

                        HEALTH_STATUS.UP,

                    checked:

                        false,

                    reason:

                        'No tenant supplied; credential resolution skipped'

                };

            }

            await withTimeout(

                this.credentialManager.resolve({

                    tenantId

                }),

                this.options.PROBE_TIMEOUT_MS,

                'Airtel credential'

            );

            return {

                status:

                    HEALTH_STATUS.UP,

                checked:

                    true

            };

        }

        catch (error) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                checked:

                    true,

                error:

                    safeErrorMessage(error)

            };

        }

    }

    /**
     * ========================================================================
     * Token Manager Check
     * ========================================================================
     */

    async checkTokenManager() {

        if (!this.tokenManager) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    'Token manager unavailable'

            };

        }

        try {

            const stats =

                typeof this.tokenManager.stats ===

                'function'

                    ? this.tokenManager.stats()

                    : null;

            const cachedTokens =

                Number.isFinite(

                    Number(

                        stats?.cachedTokens

                    )

                )

                    ? Number(

                        stats.cachedTokens

                    )

                    : undefined;

            return {

                status:

                    HEALTH_STATUS.UP,

                cacheEntries:

                    cachedTokens,

                statistics:

                    stats

            };

        }

        catch (error) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    safeErrorMessage(error)

            };

        }

    }

    /**
     * ========================================================================
     * OAuth Dependency Check
     * ========================================================================
     *
     * Does not execute an authentication request unless the OAuth client
     * explicitly defines a safe health() implementation.
     */

    async checkOAuth() {

        if (!this.oauthClient) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    'OAuth client unavailable'

            };

        }

        try {

            if (

                typeof this.oauthClient.health ===

                'function'

            ) {

                const result =

                    await withTimeout(

                        Promise.resolve(

                            this.oauthClient.health()

                        ),

                        this.options.PROBE_TIMEOUT_MS,

                        'Airtel OAuth'

                    );

                return sanitizeHealthResult(

                    result

                );

            }

            return {

                status:

                    HEALTH_STATUS.UP,

                checked:

                    false,

                reason:

                    'OAuth client does not expose health()'

            };

        }

        catch (error) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    safeErrorMessage(error)

            };

        }

    }

    /**
     * ========================================================================
     * Authentication Service Check
     * ========================================================================
     */

    async checkAuthentication() {

        if (!this.authService) {

            return {

                status:

                    this.options

                        .LIVENESS_REQUIRES_AUTH

                        ? HEALTH_STATUS.DOWN

                        : HEALTH_STATUS.UNKNOWN,

                reason:

                    'Authentication service unavailable'

            };

        }

        try {

            if (

                typeof this.authService.health ===

                'function'

            ) {

                const result =

                    await withTimeout(

                        Promise.resolve(

                            this.authService.health()

                        ),

                        this.options.PROBE_TIMEOUT_MS,

                        'Airtel authentication service'

                    );

                return sanitizeHealthResult(

                    result

                );

            }

            return {

                status:

                    HEALTH_STATUS.UP

            };

        }

        catch (error) {

            return {

                status:

                    HEALTH_STATUS.DOWN,

                error:

                    safeErrorMessage(error)

            };

        }

    }

    /**
     * ========================================================================
     * Status Aggregation
     * ========================================================================
     */

    calculateStatus(

        checks = {},

        probeType = PROBE_TYPES.FULL

    ) {

        const entries =

            Object.entries(checks);

        if (!entries.length) {

            return HEALTH_STATUS.UNKNOWN;

        }

        const statuses =

            entries.map(

                ([name, result]) => ({

                    name,

                    status:

                        normalizeStatus(

                            result

                        )

                })

            );

        const critical =

            this.getCriticalChecks(

                probeType

            );

        const criticalDown =

            statuses.some(item =>

                critical.includes(item.name) &&

                item.status ===

                    HEALTH_STATUS.DOWN

            );

        if (criticalDown) {

            return HEALTH_STATUS.DOWN;

        }

        const anyDown =

            statuses.some(item =>

                item.status ===

                    HEALTH_STATUS.DOWN

            );

        const anyUnknown =

            statuses.some(item =>

                item.status ===

                    HEALTH_STATUS.UNKNOWN

            );

        const anyDegraded =

            statuses.some(item =>

                item.status ===

                    HEALTH_STATUS.DEGRADED

            );

        if (anyDegraded) {

            return HEALTH_STATUS.DEGRADED;

        }

        if (anyDown) {

            return HEALTH_STATUS.DEGRADED;

        }

        if (anyUnknown) {

            return HEALTH_STATUS.DEGRADED;

        }

        return HEALTH_STATUS.UP;

    }

    /**
     * ========================================================================
     * Critical Check Policy
     * ========================================================================
     */

    getCriticalChecks(probeType) {

        switch (probeType) {

            case PROBE_TYPES.READINESS:

                return [

                    'configuration',

                    'tokenManager',

                    'oauth',

                    ...(this.options

                        .READINESS_REQUIRES_CREDENTIALS

                        ? ['credentials']

                        : [])

                ];

            case PROBE_TYPES.STARTUP:

                return [

                    'configuration',

                    'tokenManager',

                    'oauth'

                ];

            case PROBE_TYPES.LIVENESS:

                return [];

            case PROBE_TYPES.FULL:

            default:

                return [

                    'configuration',

                    'oauth',

                    'tokenManager'

                ];

        }

    }

    /**
     * ========================================================================
     * Startup Critical Failure
     * ========================================================================
     */

    hasCriticalStartupFailure(checks) {

        const critical =

            this.getCriticalChecks(

                PROBE_TYPES.STARTUP

            );

        return critical.some(name =>

            normalizeStatus(

                checks[name]

            ) === HEALTH_STATUS.DOWN

        );

    }

    /**
     * ========================================================================
     * Result Recording
     * ========================================================================
     */

    recordResult(report) {

        this.lastHealthCheck = report;

        const status = report.status;

        if (

            status === HEALTH_STATUS.UP

        ) {

            this.statistics.successful++;

            this.consecutiveSuccesses++;

            this.failureCount = 0;

            this.lastSuccessfulCheck =

                report.timestamp;

        }

        else {

            this.statistics.failed++;

            this.failureCount++;

            this.consecutiveSuccesses = 0;

            if (

                status ===

                    HEALTH_STATUS.DEGRADED

            ) {

                this.statistics.degraded++;

            }

            if (

                status ===

                    HEALTH_STATUS.UNKNOWN

            ) {

                this.statistics.unknown++;

            }

        }

    }

    /**
     * ========================================================================
     * State Transition Detection
     * ========================================================================
     */

    publishTransitionIfNeeded(report) {

        const previousStatus =

            this.lastStatus;

        const currentStatus =

            report.status;

        if (

            previousStatus !==

            currentStatus

        ) {

            this.statistics.statusTransitions++;

            this.metrics?.counter?.(

                'payment_airtel_auth_health_status_transition_total'

            );

            this.eventBus?.publish?.({

                type:

                    'AIRTEL_AUTH_HEALTH_STATUS_CHANGED',

                payload: {

                    provider: PROVIDER,

                    component: COMPONENT,

                    previousStatus,

                    currentStatus,

                    timestamp:

                        report.timestamp,

                    correlationId:

                        report.correlationId

                }

            });

            this.lastStatus =

                currentStatus;

        }

    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    publishMetrics(report) {

        const statusValue =

            report.status ===

                HEALTH_STATUS.UP

                ? 1

                : report.status ===

                    HEALTH_STATUS.DEGRADED

                    ? 0.5

                    : 0;

        this.metrics?.gauge?.(

            'payment_airtel_auth_health',

            statusValue

        );

        this.metrics?.histogram?.(

            'payment_airtel_auth_health_duration_ms',

            report.durationMs

        );

        this.metrics?.gauge?.(

            'payment_airtel_auth_health_failure_count',

            this.failureCount

        );

        this.metrics?.gauge?.(

            'payment_airtel_auth_health_stale',

            this.isStale() ? 1 : 0

        );

        this.metrics?.counter?.(

            'payment_airtel_auth_health_check_total'

        );

    }

    /**
     * ========================================================================
     * Event Publishing
     * ========================================================================
     */

    publishEvent(report) {

        try {

            this.eventBus?.publish?.({

                type:

                    'AIRTEL_AUTH_HEALTH_CHECK_COMPLETED',

                payload: {

                    provider:

                        PROVIDER,

                    component:

                        COMPONENT,

                    status:

                        report.status,

                    timestamp:

                        report.timestamp,

                    durationMs:

                        report.durationMs,

                    correlationId:

                        report.correlationId,

                    failureCount:

                        report.failureCount

                }

            });

        }

        catch (error) {

            this.logger?.warn?.({

                message:

                    'Failed to publish Airtel health event',

                error:

                    safeErrorMessage(error)

            });

        }

    }

    /**
     * ========================================================================
     * Alert Management
     * ========================================================================
     */

    async triggerAlert(report) {

        if (!this.alertService?.notify) {

            return false;

        }

        const now = Date.now();

        const cooldownExpired =

            !this.lastAlertAt ||

            now - this.lastAlertAt >=

                this.options.ALERT_COOLDOWN_MS;

        const thresholdReached =

            this.failureCount >=

                this.options.ALERT_FAILURE_THRESHOLD;

        const statusChanged =

            this.lastAlertStatus !==

            report.status;

        if (

            !cooldownExpired &&

            !statusChanged &&

            !thresholdReached

        ) {

            this.statistics.suppressedAlerts++;

            this.metrics?.counter?.(

                'payment_airtel_auth_health_alert_suppressed_total'

            );

            return false;

        }

        try {

            await this.alertService.notify({

                service:

                    SERVICE_NAME,

                provider:

                    PROVIDER,

                component:

                    COMPONENT,

                severity:

                    report.status ===

                        HEALTH_STATUS.DOWN

                        ? 'CRITICAL'

                        : 'WARNING',

                status:

                    report.status,

                failureCount:

                    this.failureCount,

                correlationId:

                    report.correlationId,

                timestamp:

                    report.timestamp,

                report: {

                    status:

                        report.status,

                    durationMs:

                        report.durationMs,

                    checks:

                        report.checks

                }

            });

            this.lastAlertAt = now;

            this.lastAlertStatus =

                report.status;

            this.statistics.alerts++;

            this.metrics?.counter?.(

                'payment_airtel_auth_health_alert_total'

            );

            return true;

        }

        catch (error) {

            this.logger?.error?.({

                message:

                    'Failed to dispatch Airtel authentication health alert',

                error:

                    safeErrorMessage(error)

            });

            return false;

        }

    }

    /**
     * ========================================================================
     * Stale Health Detection
     * ========================================================================
     */

    isStale() {

        if (!this.lastHealthCheck) {

            return true;

        }

        const age =

            Date.now() -

            new Date(

                this.lastHealthCheck.timestamp

            ).getTime();

        return (

            !Number.isFinite(age) ||

            age >

                this.options.HEALTH_STALE_AFTER_MS

        );

    }

    /**
     * ========================================================================
     * Runtime Snapshot
     * ========================================================================
     */

    snapshot() {

        return {

            provider:

                PROVIDER,

            component:

                COMPONENT,

            initialized:

                this.initialized,

            startedAt:

                this.startedAt,

            uptimeMs:

                Date.now() -

                this.startedAt.getTime(),

            lastStatus:

                this.lastStatus,

            lastHealthCheck:

                this.lastHealthCheck

                    ?.timestamp || null,

            lastSuccessfulCheck:

                this.lastSuccessfulCheck,

            stale:

                this.isStale(),

            failureCount:

                this.failureCount,

            consecutiveSuccesses:

                this.consecutiveSuccesses,

            checkInProgress:

                this.checkInProgress,

            statistics: {

                ...this.statistics

            }

        };

    }

    /**
     * ========================================================================
     * Statistics
     * ========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            failureCount:

                this.failureCount,

            consecutiveSuccesses:

                this.consecutiveSuccesses,

            lastStatus:

                this.lastStatus,

            stale:

                this.isStale(),

            uptimeMs:

                Date.now() -

                this.startedAt.getTime()

        };

    }

    /**
     * ========================================================================
     * Dependency Summary
     * ========================================================================
     */

    dependencies() {

        return {

            authService:

                !!this.authService,

            oauthClient:

                !!this.oauthClient,

            tokenManager:

                !!this.tokenManager,

            credentialManager:

                !!this.credentialManager,

            configuration:

                !!this.configuration,

            logger:

                !!this.logger,

            metrics:

                !!this.metrics,

            tracer:

                !!this.tracer,

            eventBus:

                !!this.eventBus,

            alertService:

                !!this.alertService

        };

    }

    /**
     * ========================================================================
     * Capabilities
     * ========================================================================
     */

    capabilities() {

        return Object.freeze({

            provider:

                PROVIDER,

            component:

                COMPONENT,

            fullHealth:

                true,

            readiness:

                true,

            liveness:

                true,

            startup:

                true,

            configurationCheck:

                !!this.configuration,

            credentialCheck:

                !!this.credentialManager,

            tokenManagerCheck:

                !!this.tokenManager,

            oauthCheck:

                !!this.oauthClient,

            authenticationCheck:

                !!this.authService,

            metrics:

                !!this.metrics,

            tracing:

                !!this.tracer,

            events:

                !!this.eventBus,

            alerts:

                !!this.alertService,

            staleDetection:

                true,

            alertSuppression:

                true,

            transitionDetection:

                true,

            concurrentProbeProtection:

                true

        });

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    HealthMonitor,

    HEALTH_STATUS,

    PROBE_TYPES

};