'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN Collection Transaction State Machine
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Create collection transactions
 * • Validate lifecycle transitions
 * • Prevent illegal state changes
 * • Maintain transition history
 * • Publish domain events
 * • Record audit entries
 * • Support idempotent processing
 * • Record lifecycle timestamps
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN API calls
 * ✗ Perform ledger posting
 * ✗ Perform reconciliation
 * ✗ Execute business validation
 *
 * =============================================================================
 */

class TransactionStateMachine {

    constructor({

        repository,

        eventBus,

        auditService,

        metrics,

        logger,

        transitions

    } = {}) {

        if (!repository) {
            throw new Error(
                'TransactionStateMachine requires repository.'
            );
        }

        this.repository = repository;

        this.eventBus = eventBus;

        this.auditService = auditService;

        this.metrics = metrics;

        this.logger = logger || console;

        this.transitions =
            transitions || {

                CREATED: [

                    'PENDING_APPROVAL',

                    'FAILED',

                    'CANCELLED'

                ],

                PENDING_APPROVAL: [

                    'APPROVED',

                    'REJECTED',

                    'FAILED'

                ],

                APPROVED: [

                    'SUBMITTED',

                    'FAILED'

                ],

                SUBMITTED: [

                    'PENDING_CALLBACK',

                    'FAILED'

                ],

                PENDING_CALLBACK: [

                    'SUCCESSFUL',

                    'FAILED',

                    'EXPIRED'

                ],

                SUCCESSFUL: [

                    'LEDGER_POSTED'

                ],

                LEDGER_POSTED: [

                    'SETTLED'

                ],

                FAILED: [],

                REJECTED: [],

                CANCELLED: [],

                EXPIRED: [],

                SETTLED: []

            };

    }

    /**
     * =========================================================================
     * Create Transaction
     * =========================================================================
     */

    async create(data = {}) {

        const now = new Date();

        const transaction =
            await this.repository.create({

                ...data,

                status: 'CREATED',

                createdAt: now,

                updatedAt: now,

                statusHistory: [

                    {

                        status: 'CREATED',

                        timestamp: now

                    }

                ]

            });

        this.metrics?.increment?.(

            'payment.transaction.created'

        );

        await this.eventBus?.publish?.({

            type: 'TRANSACTION_CREATED',

            payload: transaction

        });

        return transaction;

    }

    /**
     * =========================================================================
     * Transition
     * =========================================================================
     */

    async transition({

        id,

        nextStatus,

        metadata = {},

        actor = 'SYSTEM'

    } = {}) {

        const started = Date.now();

        if (!id) {

            throw this.#error(

                'VALIDATION_ERROR',

                'Transaction id is required.',

                400

            );

        }

        if (!nextStatus) {

            throw this.#error(

                'VALIDATION_ERROR',

                'nextStatus is required.',

                400

            );

        }

        const transaction =
            await this.repository.findById(id);

        if (!transaction) {

            throw this.#error(

                'TRANSACTION_NOT_FOUND',

                'Transaction not found.',

                404

            );

        }

        const currentStatus =
            String(transaction.status)
                .toUpperCase();

        nextStatus =
            String(nextStatus)
                .toUpperCase();

        /**
         * ---------------------------------------------------------------------
         * Idempotency
         * ---------------------------------------------------------------------
         */

        if (currentStatus === nextStatus) {

            this.logger.info?.({

                event: 'transaction.transition.idempotent',

                transactionId: id,

                status: currentStatus

            });

            return transaction;

        }

        const allowed =
            this.transitions[currentStatus] || [];

        if (!allowed.includes(nextStatus)) {

            throw this.#error(

                'INVALID_TRANSITION',

                `Invalid transition ${currentStatus} -> ${nextStatus}`,

                409

            );

        }

        const history =
            Array.isArray(transaction.statusHistory)

                ? [...transaction.statusHistory]

                : [];

        history.push({

            from: currentStatus,

            to: nextStatus,

            actor,

            metadata,

            timestamp: new Date()

        });

        const update = {

            status: nextStatus,

            updatedAt: new Date(),

            statusHistory: history

        };

        /**
         * Lifecycle timestamps
         */

        update[`${nextStatus.toLowerCase()}At`] =
            new Date();

        const updated =
            await this.repository.update(

                id,

                update

            );

        /**
         * Audit
         */

        await this.auditService?.record({

            action: 'TRANSACTION_STATUS_CHANGED',

            transactionId: id,

            previousStatus: currentStatus,

            newStatus: nextStatus,

            actor,

            metadata,

            timestamp: new Date()

        });

        /**
         * Metrics
         */

        this.metrics?.increment?.(

            'payment.transaction.transition'

        );

        this.metrics?.observe?.(

            'payment.transaction.transition.duration',

            Date.now() - started

        );

        /**
         * Domain Event
         */

        await this.eventBus?.publish?.({

            type: `TRANSACTION_${nextStatus}`,

            payload: updated,

            metadata: {

                previousStatus: currentStatus,

                actor

            }

        });

        this.logger.info?.({

            event: 'transaction.transition.completed',

            transactionId: id,

            from: currentStatus,

            to: nextStatus

        });

        return updated;

    }

    /**
     * =========================================================================
     * Allowed Transitions
     * =========================================================================
     */

    getAllowedTransitions(status) {

        return [

            ...(this.transitions[

                String(status).toUpperCase()

            ] || [])

        ];

    }

    /**
     * =========================================================================
     * Can Transition
     * =========================================================================
     */

    canTransition({

        currentStatus,

        nextStatus

    }) {

        return this.getAllowedTransitions(

            currentStatus

        ).includes(

            String(nextStatus).toUpperCase()

        );

    }

    /**
     * =========================================================================
     * Terminal State
     * =========================================================================
     */

    isTerminal(status) {

        return this.getAllowedTransitions(status)

            .length === 0;

    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    #error(code, message, statusCode = 500) {

        const error =
            new Error(message);

        error.name =
            'TransactionStateMachineError';

        error.code =
            code;

        error.statusCode =
            statusCode;

        return error;

    }

}

module.exports = TransactionStateMachine;