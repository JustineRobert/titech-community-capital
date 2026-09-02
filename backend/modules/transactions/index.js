'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Module
 * ============================================================================
 *
 * Transaction domain composition root.
 *
 * Responsibilities
 * ----------------
 * • Export transaction components
 * • Create configured transaction runtime
 * • Wire dependencies
 * • Wire persistent distributed transaction coordination
 * • Wire saga recovery
 * • Provide health information
 * • Provide lifecycle management
 * • Support dependency injection
 * • Support worker/recovery deployment
 *
 * Architecture
 * ------------
 *
 *                  Transaction Module
 *                          │
 *          ┌───────────────┼────────────────┐
 *          ▼               ▼                ▼
 *     Transaction      Distributed      Recovery
 *     Runtime          Saga Manager      Adapter
 *          │               │                │
 *          │               ▼                │
 *          │       Persistent Repository    │
 *          │               │                │
 *          │               ▼                │
 *          │    DistributedTransactionRecord│
 *          │                                │
 *          └──────────────► Ledger/Payment ◄┘
 *
 * IMPORTANT
 * ---------
 * Distributed transaction state is coordination state.
 *
 * Financial truth remains in:
 *
 * • Transaction
 * • Journal
 * • JournalEntry
 * • Account
 * • Ledger
 *
 * ============================================================================
 */


/**
 * ============================================================================
 * Existing Core Components
 * ============================================================================
 */

const DistributedTransactionManager =
    require('./DistributedTransactionManager');


const TransactionContext =
    require('./TransactionContext');


const TransactionStateMachine =
    require('./TransactionStateMachine');


const TransactionRepository =
    require('./TransactionRepository');


const TransactionLockManager =
    require('./TransactionLockManager');


const TransactionRecoveryManager =
    require('./TransactionRecoveryManager');


const TransactionRetryPolicy =
    require('./TransactionRetryPolicy');


const TransactionTimeoutManager =
    require('./TransactionTimeoutManager');


const TransactionAuditPublisher =
    require('./TransactionAuditPublisher');


const TransactionMetrics =
    require('./TransactionMetrics');


const TransactionTracer =
    require('./TransactionTracer');


const TransactionLogger =
    require('./TransactionLogger');


const TransactionValidator =
    require('./TransactionValidator');


const TransactionIdempotencyManager =
    require('./TransactionIdempotencyManager');


const RollbackCoordinator =
    require('./RollbackCoordinator');


const CompensationManager =
    require('./CompensationManager');


const TransactionEvents =
    require('./TransactionEvents');


const TransactionErrors =
    require('./TransactionErrors');


const TransactionConstants =
    require('./TransactionConstants');


/**
 * ============================================================================
 * Persistent Distributed Saga Components
 * ============================================================================
 *
 * These are the newer durable workflow components.
 *
 * We keep them separate from the existing TransactionRepository because the
 * two repositories have different responsibilities:
 *
 * TransactionRepository
 *     → business transaction domain
 *
 * DistributedTransactionRepository
 *     → saga/workflow coordination state
 */

const DistributedTransactionRepository =
    require('./repositories/DistributedTransactionRepository');


const DistributedTransactionRecoveryAdapter =
    require('./recovery/DistributedTransactionRecoveryAdapter');


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function ensureObject(
    value,
    name
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        throw new TypeError(
            `${name} must be an object`
        );

    }

    return value;

}


function safeHealth(
    component,
    method
) {

    try {

        if (
            typeof component?.[method] ===
            'function'
        ) {

            return component[method]();

        }

        return 'AVAILABLE';

    }
    catch (error) {

        return {

            status:
                'DOWN',

            error:
                error?.message ||
                String(error)

        };

    }

}


/**
 * ============================================================================
 * Transaction Runtime Factory
 * ============================================================================
 */

function createTransactionModule(
    options = {}
) {

    /**
     * ------------------------------------------------------------------------
     * Infrastructure
     * ------------------------------------------------------------------------
     */

    const logger =

        options.logger ||

        new TransactionLogger({

            serviceName:
                options.serviceName ||
                'transactions'

        });


    const metrics =

        options.metrics ||

        new TransactionMetrics({

            logger

        });


    const tracer =

        options.tracer ||

        new TransactionTracer({

            logger,

            metrics

        });


    const auditPublisher =

        options.auditPublisher ||

        new TransactionAuditPublisher({

            logger,

            metrics,

            tracer

        });


    /**
     * ------------------------------------------------------------------------
     * Business Transaction Repository
     * ------------------------------------------------------------------------
     *
     * Existing repository retained for transaction-domain operations.
     */

    const repository =

        options.repository ||

        new TransactionRepository({

            logger

        });


    /**
     * ------------------------------------------------------------------------
     * Distributed Saga Repository
     * ------------------------------------------------------------------------
     *
     * NEW durable workflow coordination repository.
     */

    const distributedTransactionRepository =

        options.distributedTransactionRepository ||

        options.distributedRepository ||

        new DistributedTransactionRepository({

            logger,

            metrics,

            model:
                options.distributedTransactionModel,

            clock:
                options.clock || Date,

            recoveryLimit:
                options.recoveryLimit,

            defaultLeaseMs:
                options.defaultLeaseMs,

            maxHistory:
                options.maxHistory

        });


    /**
     * ------------------------------------------------------------------------
     * Retry / Timeout / Lock Infrastructure
     * ------------------------------------------------------------------------
     */

    const retryPolicy =

        options.retryPolicy ||

        new TransactionRetryPolicy({

            logger,

            metrics

        });


    const timeoutManager =

        options.timeoutManager ||

        new TransactionTimeoutManager({

            logger,

            metrics

        });


    const lockManager =

        options.lockManager ||

        new TransactionLockManager({

            logger,

            metrics

        });


    const idempotencyManager =

        options.idempotencyManager ||

        new TransactionIdempotencyManager({

            logger,

            metrics

        });


    /**
     * ------------------------------------------------------------------------
     * Validation
     * ------------------------------------------------------------------------
     */

    const validator =

        options.validator ||

        new TransactionValidator({

            logger,

            metrics,

            auditPublisher,

            idempotencyStore:
                idempotencyManager

        });


    /**
     * ------------------------------------------------------------------------
     * Compensation / Rollback
     * ------------------------------------------------------------------------
     */

    const compensationManager =

        options.compensationManager ||

        new CompensationManager({

            logger,

            repository,

            retryPolicy,

            timeoutManager,

            auditPublisher,

            metrics,

            tracer,

            eventBus:
                options.eventBus

        });


    const rollbackCoordinator =

        options.rollbackCoordinator ||

        new RollbackCoordinator({

            logger,

            repository,

            retryPolicy,

            timeoutManager,

            auditPublisher,

            metrics,

            tracer,

            eventBus:
                options.eventBus

        });


    /**
     * ------------------------------------------------------------------------
     * State Machine
     * ------------------------------------------------------------------------
     */

    const stateMachine =

        options.stateMachine ||

        new TransactionStateMachine({

            logger,

            metrics,

            auditPublisher

        });


    /**
     * ------------------------------------------------------------------------
     * Persistent Distributed Transaction Manager
     * ------------------------------------------------------------------------
     *
     * IMPORTANT:
     *
     * The saga manager receives the persistent repository as its persistence
     * adapter.
     *
     * The lock manager is also passed as the distributed lock adapter where
     * supported by the implementation.
     */

    const transactionManager =

        options.transactionManager ||

        new DistributedTransactionManager({

            logger,

            metrics,

            tracer,

            auditPublisher,

            eventBus:
                options.eventBus,

            persistenceAdapter:
                distributedTransactionRepository,

            lockAdapter:
                options.distributedLockAdapter ||
                lockManager,

            retryPolicy,

            timeout:
                options.transactionTimeout,

            retries:
                options.transactionRetries,

            tenantId:
                options.tenantId,

            correlationId:
                options.correlationId,

            requestId:
                options.requestId,

            idempotencyKey:
                options.idempotencyKey

        });


    /**
     * ------------------------------------------------------------------------
     * Operation Registry
     * ------------------------------------------------------------------------
     *
     * Recovery MUST resolve executable handlers from trusted application code.
     *
     * Never deserialize functions from MongoDB.
     */

    const operationRegistry =

        options.operationRegistry ||

        new Map();


    /**
     * ------------------------------------------------------------------------
     * Recovery Adapter
     * ------------------------------------------------------------------------
     */

    const recoveryAdapter =

        options.recoveryAdapter ||

        new DistributedTransactionRecoveryAdapter({

            repository:
                distributedTransactionRepository,

            operationRegistry,

            logger,

            metrics,

            tracer,

            auditPublisher,

            eventBus:
                options.eventBus,

            workerId:
                options.workerId,

            leaseMs:
                options.recoveryLeaseMs,

            heartbeatIntervalMs:
                options.recoveryHeartbeatIntervalMs,

            batchSize:
                options.recoveryBatchSize,

            recoveryDelayMs:
                options.recoveryDelayMs,

            maxRecoveryAttempts:
                options.maxRecoveryAttempts,

            managerFactory:
                options.managerFactory,

            managerOptions: {

                retryPolicy,

                timeout:
                    options.transactionTimeout,

                retries:
                    options.transactionRetries,

                lockAdapter:
                    options.distributedLockAdapter ||
                    lockManager

            }

        });


    /**
     * ------------------------------------------------------------------------
     * Existing Recovery Manager
     * ------------------------------------------------------------------------
     *
     * Retained for compatibility with the existing transaction domain.
     */

    const recoveryManager =

        options.recoveryManager ||

        new TransactionRecoveryManager({

            logger,

            repository,

            rollbackCoordinator,

            metrics

        });


    /**
     * ------------------------------------------------------------------------
     * Events
     * ------------------------------------------------------------------------
     */

    const events =

        options.events ||

        new TransactionEvents({

            serviceName:
                options.serviceName ||
                'transactions'

        });


    /**
     * ------------------------------------------------------------------------
     * Lifecycle State
     * ------------------------------------------------------------------------
     */

    let shutdownStarted =
        false;


    let recoveryStarted =
        false;


    /**
     * ------------------------------------------------------------------------
     * Runtime Object
     * ------------------------------------------------------------------------
     */

    const runtime = {

        /**
         * ================================================================
         * Core transaction runtime
         * ================================================================
         */

        transactionManager,

        stateMachine,

        repository,

        recoveryManager,

        retryPolicy,

        timeoutManager,

        lockManager,

        validator,

        idempotencyManager,

        rollbackCoordinator,

        compensationManager,

        events,


        /**
         * ================================================================
         * Durable distributed saga runtime
         * ================================================================
         */

        distributedTransactionRepository,

        recoveryAdapter,

        operationRegistry,


        /**
         * ================================================================
         * Observability
         * ================================================================
         */

        auditPublisher,

        metrics,

        tracer,

        logger,


        /**
         * ================================================================
         * Compatibility aliases
         * ================================================================
         *
         * Useful while existing code migrates to the more explicit names.
         */

        distributedRepository:
            distributedTransactionRepository,

        distributedRecovery:
            recoveryAdapter,


        /**
         * ================================================================
         * Health
         * ================================================================
         */

        health() {

            const components = {

                transactionManager:
                    safeHealth(
                        transactionManager,
                        'health'
                    ),

                transactionRepository:
                    safeHealth(
                        repository,
                        'health'
                    ),

                distributedRepository:
                    safeHealth(
                        distributedTransactionRepository,
                        'health'
                    ),

                recoveryAdapter:
                    safeHealth(
                        recoveryAdapter,
                        'health'
                    ),

                recoveryManager:
                    safeHealth(
                        recoveryManager,
                        'health'
                    ),

                locks:
                    safeHealth(
                        lockManager,
                        'health'
                    ),

                metrics:
                    safeHealth(
                        metrics,
                        'health'
                    ),

                tracer:
                    safeHealth(
                        tracer,
                        'health'
                    ),

                timeoutManager:
                    safeHealth(
                        timeoutManager,
                        'health'
                    )

            };


            const statuses =
                Object.values(
                    components
                )
                    .map(
                        component =>
                            typeof component === 'string'
                                ? component
                                : component?.status
                    );


            const status =

                statuses.includes('DOWN')
                    ? 'DOWN'

                    : statuses.includes('DEGRADED')
                        ? 'DEGRADED'

                        : 'UP';


            return {

                status,

                module:
                    'transactions',

                service:
                    options.serviceName ||
                    'transactions',

                runtime: {

                    recoveryWorker:
                        recoveryStarted,

                    shutdown:
                        shutdownStarted

                },

                components

            };

        },


        /**
         * ================================================================
         * Runtime statistics
         * ================================================================
         */

        stats() {

            return {

                transactionManager:
                    transactionManager.stats?.(),

                distributedRepository:
                    distributedTransactionRepository.stats?.(),

                recoveryAdapter:
                    recoveryAdapter.stats?.(),

                metrics:
                    metrics.stats?.(),

                uptimeMs:
                    Date.now() -
                    runtime.startedAt.getTime()

            };

        },


        /**
         * ================================================================
         * Start recovery worker
         * ================================================================
         *
         * This is intentionally opt-in.
         *
         * API processes should generally not automatically become recovery
         * workers unless explicitly configured.
         */

        async startRecoveryWorker({

            tenantId:
                recoveryTenantId =
                    options.tenantId,

            intervalMs =
                options.recoveryIntervalMs

        } = {}) {

            if (
                shutdownStarted
            ) {

                throw new Error(
                    'Transaction runtime is shutting down'
                );

            }


            if (
                recoveryStarted
            ) {

                return false;

            }


            recoveryStarted =
                true;


            logger.info?.({

                message:
                    'Distributed transaction recovery worker starting',

                workerId:
                    recoveryAdapter.workerId,

                tenantId:
                    recoveryTenantId

            });


            /**
             * Intentionally do not await the continuous loop.
             *
             * It owns its own lifecycle and is stopped through shutdown().
             */
            recoveryAdapter
                .start({

                    tenantId:
                        recoveryTenantId,

                    intervalMs

                })
                .catch(
                    error => {

                        recoveryStarted =
                            false;


                        logger.error?.({

                            message:
                                'Distributed transaction recovery worker stopped unexpectedly',

                            error:
                                error?.message ||
                                String(error)

                        });

                    }
                );


            return true;

        },


        /**
         * ================================================================
         * Recover one saga immediately
         * ================================================================
         */

        async recoverTransaction({

            tenantId,
            transactionId

        } = {}) {

            return recoveryAdapter.recover({

                tenantId,

                transactionId

            });

        },


        /**
         * ================================================================
         * Graceful shutdown
         * ================================================================
         */

        async shutdown() {

            if (
                shutdownStarted
            ) {

                return true;

            }


            shutdownStarted =
                true;


            logger.info?.({

                message:
                    'Transaction runtime shutdown starting'

            });


            /**
             * ------------------------------------------------------------
             * Stop recovery first.
             * ------------------------------------------------------------
             *
             * This prevents new recovery work from being claimed while
             * infrastructure is being shut down.
             */

            try {

                await recoveryAdapter.shutdown?.();

            }
            catch (error) {

                logger.error?.({

                    message:
                        'Distributed transaction recovery shutdown failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            recoveryStarted =
                false;


            /**
             * ------------------------------------------------------------
             * Existing recovery manager.
             * ------------------------------------------------------------
             */

            try {

                await recoveryManager.shutdown?.();

            }
            catch (error) {

                logger.warn?.({

                    message:
                        'Transaction recovery manager shutdown failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            /**
             * ------------------------------------------------------------
             * Stop timeout/lock infrastructure.
             * ------------------------------------------------------------
             */

            try {

                await timeoutManager.shutdown?.();

            }
            catch (error) {

                logger.warn?.({

                    message:
                        'Transaction timeout manager shutdown failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            try {

                await lockManager.shutdown?.();

            }
            catch (error) {

                logger.warn?.({

                    message:
                        'Transaction lock manager shutdown failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            /**
             * ------------------------------------------------------------
             * Tracing should be closed after application work has drained.
             * ------------------------------------------------------------
             */

            try {

                await tracer.shutdown?.();

            }
            catch (error) {

                logger.warn?.({

                    message:
                        'Transaction tracer shutdown failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            /**
             * ------------------------------------------------------------
             * Metrics final flush, if supported.
             * ------------------------------------------------------------
             */

            try {

                await metrics.flush?.();

            }
            catch (error) {

                logger.warn?.({

                    message:
                        'Transaction metrics flush failed',

                    error:
                        error?.message ||
                        String(error)

                });

            }


            logger.info?.({

                message:
                    'Transaction runtime shutdown complete'

            });


            return true;

        },


        /**
         * ================================================================
         * Start timestamp
         * ================================================================
         */

        startedAt:
            new Date()

    };


    /**
     * ------------------------------------------------------------------------
     * Validate critical wiring
     * ------------------------------------------------------------------------
     */

    ensureObject(
        transactionManager,
        'transactionManager'
    );

    ensureObject(
        distributedTransactionRepository,
        'distributedTransactionRepository'
    );

    ensureObject(
        recoveryAdapter,
        'recoveryAdapter'
    );


    return runtime;

}


/**
 * ============================================================================
 * Public Module API
 * ============================================================================
 */

module.exports = {

    /**
     * Factory
     */
    createTransactionModule,


    /**
     * Core classes
     */

    DistributedTransactionManager,

    TransactionContext,

    TransactionStateMachine,

    TransactionRepository,

    TransactionLockManager,

    TransactionRecoveryManager,

    TransactionRetryPolicy,

    TransactionTimeoutManager,

    TransactionAuditPublisher,

    TransactionMetrics,

    TransactionTracer,

    TransactionLogger,

    TransactionValidator,

    TransactionIdempotencyManager,

    RollbackCoordinator,

    CompensationManager,

    TransactionEvents,


    /**
     * Durable distributed saga components
     */

    DistributedTransactionRepository,

    DistributedTransactionRecoveryAdapter,


    /**
     * Errors
     */

    ...TransactionErrors,


    /**
     * Constants
     */

    ...TransactionConstants

};