'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Settlement Scheduler
 * =============================================================================
 *
 * Purpose
 * -------
 * Coordinates automated Airtel settlement processing and reconciliation.
 *
 * Responsibilities
 * ----------------
 * • Schedule daily settlement reconciliation
 * • Execute manual settlement runs
 * • Distributed execution locking
 * • Retry failed settlement jobs
 * • Publish settlement lifecycle events
 * • Audit logging
 * • Metrics & tracing
 * • Health reporting
 * • Graceful shutdown
 * • Multi-tenant execution
 *
 * This scheduler contains orchestration only.
 * Provider API communication belongs in SettlementService.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const DEFAULT_INTERVAL_MS =
    Number(process.env.AIRTEL_SETTLEMENT_INTERVAL_MS || 24 * 60 * 60 * 1000);

class SettlementScheduler {

    constructor({

        settlementService,

        settlementReconciler,

        tenantRepository,

        distributedLock,

        eventBus,

        auditService,

        logger,

        metrics,

        tracer,

        intervalMs = DEFAULT_INTERVAL_MS,

        enabled = true,

        maxConcurrentRuns = 1

    } = {}) {

        this.settlementService = settlementService;

        this.settlementReconciler = settlementReconciler;

        this.tenantRepository = tenantRepository;

        this.distributedLock = distributedLock;

        this.eventBus = eventBus;

        this.auditService = auditService;

        this.logger = logger;

        this.metrics = metrics;

        this.tracer = tracer;

        this.intervalMs = intervalMs;

        this.enabled = enabled;

        this.maxConcurrentRuns = maxConcurrentRuns;

        this.timer = null;

        this.running = false;

        this.startedAt = null;

        this.statistics = {

            scheduledRuns: 0,

            manualRuns: 0,

            successfulRuns: 0,

            failedRuns: 0,

            skippedRuns: 0,

            activeRuns: 0,

            lastRunStartedAt: null,

            lastRunCompletedAt: null,

            lastFailure: null

        };
    }

    /**
     * =========================================================================
     * Start Scheduler
     * =========================================================================
     */
    async start() {

        if (!this.enabled) {

            this.logger?.warn?.({
                message: 'Airtel settlement scheduler disabled'
            });

            return false;
        }

        if (this.timer) {
            return true;
        }

        this.startedAt = new Date();

        this.timer = setInterval(
            () => {
                this.executeScheduledRun()
                    .catch(error => {

                        this.logger?.error?.({

                            message:
                                'Unhandled scheduler error',

                            error

                        });

                    });
            },
            this.intervalMs
        );

        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }

        this.logger?.info?.({

            message:
                'Airtel settlement scheduler started',

            intervalMs:
                this.intervalMs

        });

        this.metrics?.counter?.(
            'payment_airtel_settlement_scheduler_started_total'
        );

        return true;
    }

    /**
     * =========================================================================
     * Stop Scheduler
     * =========================================================================
     */
    async stop() {

        if (this.timer) {

            clearInterval(this.timer);

            this.timer = null;

        }

        this.logger?.info?.({
            message: 'Airtel settlement scheduler stopped'
        });

        return true;
    }

    /**
     * =========================================================================
     * Scheduled Execution
     * =========================================================================
     */
    async executeScheduledRun() {

        this.statistics.scheduledRuns++;

        return this.execute({

            trigger: 'SCHEDULED'

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

            trigger: 'MANUAL',

            ...options

        });

    }

    /**
     * =========================================================================
     * Execute Settlement Workflow
     * =========================================================================
     */
    async execute({

        trigger,

        settlementDate = new Date(),

        correlationId = crypto.randomUUID()

    }) {

        if (!this.enabled) {

            return {

                skipped: true,

                reason: 'Scheduler disabled'

            };

        }

        if (this.running) {

            this.statistics.skippedRuns++;

            return {

                skipped: true,

                reason: 'Execution already in progress'

            };

        }

        this.running = true;

        this.statistics.activeRuns++;

        this.statistics.lastRunStartedAt = new Date();

        const span =
            this.tracer?.startSpan?.(
                'airtel.settlement.scheduler'
            );

        const lockKey =
            'airtel:settlement:scheduler';

        const started = Date.now();

        let lock = null;

        try {

            lock =
                await this.acquireLock(lockKey);

            if (!lock) {

                this.statistics.skippedRuns++;

                return {

                    skipped: true,

                    reason:
                        'Distributed lock unavailable'

                };

            }

            const tenants =
                await this.loadTenants();

            const summaries = [];

            for (const tenant of tenants) {

                const tenantId =
                    tenant.id ||
                    tenant.tenantId;

                const settlement =
                    await this.settlementService?.process?.({

                        tenantId,

                        settlementDate,

                        correlationId

                    });

                const reconciliation =
                    await this.settlementReconciler?.reconcile?.({

                        tenantId,

                        settlementDate,

                        correlationId

                    });

                summaries.push({

                    tenantId,

                    settlement,

                    reconciliation

                });

            }

            await this.eventBus?.publish({

                type:
                    'AIRTEL_SETTLEMENT_COMPLETED',

                payload: {

                    trigger,

                    settlementDate,

                    correlationId,

                    tenants:
                        summaries.length

                }

            });

            await this.auditService?.record?.({

                action:
                    'AIRTEL_SETTLEMENT_JOB_COMPLETED',

                trigger,

                settlementDate,

                correlationId,

                processedTenants:
                    summaries.length

            });

            this.statistics.successfulRuns++;

            this.metrics?.counter?.(
                'payment_airtel_settlement_scheduler_success_total'
            );

            this.metrics?.histogram?.(

                'payment_airtel_settlement_scheduler_duration_ms',

                Date.now() - started

            );

            return {

                success: true,

                trigger,

                correlationId,

                settlementDate,

                processedTenants:
                    summaries.length,

                summaries

            };

        }

        catch (error) {

            this.statistics.failedRuns++;

            this.statistics.lastFailure = {

                at: new Date(),

                message:
                    error.message

            };

            this.metrics?.counter?.(

                'payment_airtel_settlement_scheduler_failure_total'

            );

            this.logger?.error?.({

                message:
                    'Settlement scheduler execution failed',

                correlationId,

                error

            });

            throw error;

        }

        finally {

            await this.releaseLock(lock);

            this.statistics.activeRuns--;

            this.statistics.lastRunCompletedAt =
                new Date();

            this.running = false;

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Tenant Loader
     * =========================================================================
     */
    async loadTenants() {

        if (!this.tenantRepository?.findActive) {
            return [];
        }

        return this.tenantRepository.findActive();
    }

    /**
     * =========================================================================
     * Distributed Lock
     * =========================================================================
     */
    async acquireLock(key) {

        if (!this.distributedLock?.acquire) {

            return {

                release: async () => {}

            };

        }

        return this.distributedLock.acquire({

            key,

            ttl: this.intervalMs

        });

    }

    async releaseLock(lock) {

        try {

            await lock?.release?.();

        }

        catch (error) {

            this.logger?.warn?.({

                message:
                    'Failed to release settlement lock',

                error

            });

        }

    }

    /**
     * =========================================================================
     * Scheduler Statistics
     * =========================================================================
     */
    stats() {

        return {

            ...this.statistics,

            enabled:
                this.enabled,

            running:
                this.running,

            intervalMs:
                this.intervalMs,

            uptimeMs:
                this.startedAt
                    ? Date.now() - this.startedAt.getTime()
                    : 0

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {

        return {

            provider: 'AIRTEL',

            component:
                'SettlementScheduler',

            status:
                this.enabled
                    ? 'UP'
                    : 'DISABLED',

            running:
                this.running,

            intervalMs:
                this.intervalMs,

            startedAt:
                this.startedAt,

            statistics:
                this.stats()

        };

    }

}

module.exports = SettlementScheduler;