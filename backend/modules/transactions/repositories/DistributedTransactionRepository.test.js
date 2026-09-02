'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * DistributedTransactionRepository.test.js
 * ============================================================================
 *
 * Enterprise Jest Test Suite — Distributed Transaction Repository
 *
 * Coverage
 * --------
 * • Durable saga creation
 * • Duplicate idempotency race
 * • Tenant isolation
 * • findOne / findById
 * • Optimistic concurrency
 * • Version conflict detection
 * • Atomic claim
 * • Claim contention
 * • Heartbeat / lease renewal
 * • Lease release
 * • Completion persistence
 * • Failure persistence
 * • Rollback persistence
 * • Operation lifecycle persistence
 * • Compensation failure persistence
 * • Recovery queries
 * • Expired lease queries
 * • Compensation recovery queries
 * • Recovery scheduling
 * • Health diagnostics
 *
 * ============================================================================
 */

'use strict';

const DistributedTransactionRepository =
    require('./DistributedTransactionRepository');

const DistributedTransactionRecord =
    require('../models/DistributedTransactionRecord');

const {
    TRANSACTION_STATES,
    OPERATION_STATES,
    COMPENSATION_STATES,
    RETRY_STATES
} = require('../models/DistributedTransactionRecord');


jest.mock(
    '../models/DistributedTransactionRecord',
    () => {

        const model = jest.fn();

        model.findOne =
            jest.fn();

        model.find =
            jest.fn();

        model.create =
            jest.fn();

        model.findOneAndUpdate =
            jest.fn();

        model.findRecoverable =
            jest.fn();

        model.findActive =
            jest.fn();

        model.modelName =
            'DistributedTransactionRecord';

        return model;

    }
);


describe(
    'DistributedTransactionRepository',
    () => {

        let repository;

        let model;

        let clock;

        const TENANT_ID =
            'tenant-production';

        const TRANSACTION_ID =
            'dtx-001';

        const CORRELATION_ID =
            'corr-001';

        const REQUEST_ID =
            'req-001';

        const IDEMPOTENCY_KEY =
            'payment-idempotency-001';

        const WORKER_ID =
            'worker-node-001';


        /**
         * =====================================================================
         * Helpers
         * =====================================================================
         */

        function createDocument(
            overrides = {}
        ) {

            return {

                tenantId:
                    TENANT_ID,

                transactionId:
                    TRANSACTION_ID,

                correlationId:
                    CORRELATION_ID,

                requestId:
                    REQUEST_ID,

                idempotencyKey:
                    IDEMPOTENCY_KEY,

                state:
                    TRANSACTION_STATES.CREATED,

                compensationState:
                    COMPENSATION_STATES.NOT_REQUIRED,

                retryState: {

                    state:
                        RETRY_STATES.IDLE,

                    attempts:
                        0,

                    maxAttempts:
                        0

                },

                operations: [],

                completedOperations: [],

                executionHistory: [],

                version:
                    0,

                ...overrides

            };

        }


        function mockFindOne(
            value
        ) {

            model.findOne
                .mockReturnValueOnce({

                    exec:
                        jest.fn()
                            .mockResolvedValue(
                                value
                            )

                });

        }


        function mockCreateResult(
            value
        ) {

            model.create
                .mockResolvedValueOnce(
                    value
                );

        }


        /**
         * =====================================================================
         * Setup
         * =====================================================================
         */

        beforeEach(
            () => {

                jest.clearAllMocks();

                clock =
                    jest.useFakeTimers({
                        doNotFake: [
                            'nextTick',
                            'setImmediate',
                            'Date'
                        ]
                    });

                repository =
                    new DistributedTransactionRepository({

                        model,

                        logger: {

                            info:
                                jest.fn(),

                            warn:
                                jest.fn(),

                            error:
                                jest.fn()

                        },

                        metrics: {

                            counter:
                                jest.fn(),

                            increment:
                                jest.fn(),

                            gauge:
                                jest.fn(),

                            histogram:
                                jest.fn()

                        },

                        clock: Date

                    });

            }
        );


        afterEach(
            () => {

                clock?.useRealTimers?.();

                jest.clearAllMocks();

            }
        );


        /**
         * =====================================================================
         * CREATE
         * =====================================================================
         */

        describe(
            'create()',
            () => {

                it(
                    'creates a durable distributed transaction record',
                    async () => {

                        mockFindOne(
                            null
                        );

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            null
                                        )

                            });

                        mockCreateResult({

                            _id:
                                'mongo-dtx-001',

                            ...createDocument()

                        });


                        const result =
                            await repository.create({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID,

                                requestId:
                                    REQUEST_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY,

                                operations: [

                                    {

                                        id:
                                            'op-001',

                                        name:
                                            'Airtel Collection',

                                        timeout:
                                            5000,

                                        retries:
                                            2

                                    }

                                ]

                            });


                        expect(
                            result
                        ).toBeDefined();


                        expect(
                            model.create
                        ).toHaveBeenCalledTimes(1);


                        const payload =
                            model.create
                                .mock.calls[0][0];


                        expect(
                            payload.tenantId
                        ).toBe(
                            TENANT_ID
                        );


                        expect(
                            payload.transactionId
                        ).toBe(
                            TRANSACTION_ID
                        );


                        expect(
                            payload.correlationId
                        ).toBe(
                            CORRELATION_ID
                        );


                        expect(
                            payload.operationCount
                        ).toBe(1);


                        expect(
                            payload.operations[0].operationId
                        ).toBe(
                            'op-001'
                        );


                        expect(
                            payload.retryState.state
                        ).toBe(
                            RETRY_STATES.IDLE
                        );

                    }
                );


                it(
                    'returns the existing transaction when transactionId already exists',
                    async () => {

                        const existing =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING

                            });


                        mockFindOne(
                            existing
                        );


                        const result =
                            await repository.create({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY

                            });


                        expect(
                            result
                        ).toBe(
                            existing
                        );


                        expect(
                            model.create
                        ).not.toHaveBeenCalled();

                    }
                );


                it(
                    'returns the existing transaction when the idempotency key already exists',
                    async () => {

                        const firstLookup =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.CREATED

                            });


                        const idempotentExisting =
                            createDocument({

                                transactionId:
                                    'dtx-existing',

                                state:
                                    TRANSACTION_STATES.COMMITTED

                            });


                        mockFindOne(
                            firstLookup
                        );


                        /**
                         * The implementation first finds by transaction ID,
                         * then by idempotency key only when transactionId was
                         * not found.
                         *
                         * This test therefore uses a distinct transaction ID
                         * and mocks the second lookup accordingly.
                         */
                        model.findOne
                            .mockReset();


                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            null
                                        )

                            })
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            idempotentExisting
                                        )

                            });


                        const result =
                            await repository.create({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    'dtx-new',

                                correlationId:
                                    CORRELATION_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY

                            });


                        expect(
                            result
                        ).toBe(
                            idempotentExisting
                        );


                        expect(
                            model.create
                        ).not.toHaveBeenCalled();

                    }
                );


                it(
                    'handles a duplicate-key race during concurrent create',
                    async () => {

                        const existing =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING

                            });


                        /**
                         * First findOne() => no record.
                         */
                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            null
                                        )

                            });


                        /**
                         * Second lookup occurs after duplicate-key error.
                         */
                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            existing
                                        )

                            });


                        model.create
                            .mockRejectedValueOnce({

                                code:
                                    11000,

                                message:
                                    'E11000 duplicate key error'

                            });


                        const result =
                            await repository.create({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY

                            });


                        expect(
                            result
                        ).toBe(
                            existing
                        );


                        expect(
                            model.create
                        ).toHaveBeenCalledTimes(1);


                        expect(
                            repository.metrics?.counter
                        ).toHaveBeenCalledWith(
                            'distributed_transaction_repository_duplicate_create_total'
                        );

                    }
                );


                it(
                    'preserves tenant isolation during create',
                    async () => {

                        const existing =
                            createDocument({

                                tenantId:
                                    'tenant-a'

                            });


                        mockFindOne(
                            existing
                        );


                        const result =
                            await repository.create({

                                tenantId:
                                    'tenant-a',

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID

                            });


                        expect(
                            model.findOne
                                .mock.calls[0][0]
                        ).toEqual({

                            tenantId:
                                'tenant-a',

                            transactionId:
                                TRANSACTION_ID

                        });


                        expect(
                            result.tenantId
                        ).toBe(
                            'tenant-a'
                        );

                    }
                );

            }
        );


        /**
         * =====================================================================
         * FIND
         * =====================================================================
         */

        describe(
            'findOne() / findById() / findByIdempotencyKey()',
            () => {

                it(
                    'finds a transaction by tenant and transaction ID',
                    async () => {

                        const existing =
                            createDocument();


                        mockFindOne(
                            existing
                        );


                        const result =
                            await repository.findOne({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID

                            });


                        expect(
                            result
                        ).toBe(
                            existing
                        );


                        expect(
                            model.findOne
                        ).toHaveBeenCalledWith({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID

                        });

                    }
                );


                it(
                    'findById delegates with the tenant boundary',
                    async () => {

                        const existing =
                            createDocument();


                        mockFindOne(
                            existing
                        );


                        const result =
                            await repository.findById(

                                TENANT_ID,

                                TRANSACTION_ID

                            );


                        expect(
                            result
                        ).toBe(
                            existing
                        );

                    }
                );


                it(
                    'finds by tenant-scoped idempotency key',
                    async () => {

                        const existing =
                            createDocument();


                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            existing
                                        )

                            });


                        const result =
                            await repository.findByIdempotencyKey({

                                tenantId:
                                    TENANT_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY

                            });


                        expect(
                            result
                        ).toBe(
                            existing
                        );


                        expect(
                            model.findOne
                        ).toHaveBeenCalledWith({

                            tenantId:
                                TENANT_ID,

                            idempotencyKey:
                                IDEMPOTENCY_KEY

                        });

                    }
                );

            }
        );


        /**
         * =====================================================================
         * UPDATE / OPTIMISTIC CONCURRENCY
         * =====================================================================
         */

        describe(
            'update()',
            () => {

                it(
                    'updates saga state successfully',
                    async () => {

                        const updated =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                version:
                                    1

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                updated
                            );


                        const result =
                            await repository.update({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                patch: {

                                    state:
                                        TRANSACTION_STATES.RUNNING,

                                    operationCount:
                                        2

                                },

                                expectedVersion:
                                    0

                            });


                        expect(
                            result
                        ).toBe(
                            updated
                        );


                        expect(
                            model.findOneAndUpdate
                        ).toHaveBeenCalledWith(

                            {

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                version:
                                    0

                            },

                            expect.objectContaining({

                                $set: {

                                    state:
                                        TRANSACTION_STATES.RUNNING,

                                    operationCount:
                                        2

                                },

                                $inc: {

                                    version:
                                        1

                                }

                            }),

                            expect.objectContaining({

                                new:
                                    true,

                                runValidators:
                                    true

                            })

                        );

                    }
                );


                it(
                    'throws a version conflict when expected version is stale',
                    async () => {

                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                null
                            );


                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            createDocument({
                                                version:
                                                    7

                                            })
                                        )

                            });


                        await expect(

                            repository.update({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                patch: {

                                    state:
                                        TRANSACTION_STATES.COMMITTED

                                },

                                expectedVersion:
                                    6

                            })

                        ).rejects.toMatchObject({

                            code:
                                'DISTRIBUTED_TRANSACTION_VERSION_CONFLICT',

                            retryable:
                                true

                        });

                    }
                );


                it(
                    'returns null when a transaction does not exist',
                    async () => {

                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                null
                            );


                        const result =
                            await repository.update({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    'missing',

                                patch: {

                                    state:
                                        TRANSACTION_STATES.RUNNING

                                }

                            });


                        expect(
                            result
                        ).toBeNull();

                    }
                );

            }
        );


        /**
         * =====================================================================
         * ATOMIC CLAIM
         * =====================================================================
         */

        describe(
            'claim()',
            () => {

                it(
                    'atomically claims a recoverable transaction',
                    async () => {

                        const claimed =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                workerId:
                                    WORKER_ID,

                                leaseExpiresAt:
                                    new Date(
                                        Date.now() +
                                        30000
                                    ),

                                recoveryAttempts:
                                    1,

                                version:
                                    1

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                claimed
                            );


                        const result =
                            await repository.claim({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                workerId:
                                    WORKER_ID,

                                leaseMs:
                                    30000

                            });


                        expect(
                            result
                        ).toBe(
                            claimed
                        );


                        const [
                            filter,
                            update,
                            options
                        ] =
                            model.findOneAndUpdate
                                .mock.calls[0];


                        expect(
                            filter.tenantId
                        ).toBe(
                            TENANT_ID
                        );


                        expect(
                            filter.transactionId
                        ).toBe(
                            TRANSACTION_ID
                        );


                        expect(
                            filter.$or
                        ).toEqual(
                            expect.arrayContaining([
                                {
                                    workerId:
                                        WORKER_ID
                                },
                                expect.any(Object),
                                expect.any(Object),
                                expect.any(Object)
                            ])
                        );


                        expect(
                            filter.state.$in
                        ).toEqual(
                            expect.arrayContaining([

                                TRANSACTION_STATES.CREATED,

                                TRANSACTION_STATES.RUNNING,

                                TRANSACTION_STATES.ROLLING_BACK,

                                TRANSACTION_STATES.COMPENSATION_FAILED

                            ])
                        );


                        expect(
                            update.$set.workerId
                        ).toBe(
                            WORKER_ID
                        );


                        expect(
                            update.$inc.recoveryAttempts
                        ).toBe(1);


                        expect(
                            update.$inc.version
                        ).toBe(1);


                        expect(
                            options.new
                        ).toBe(true);

                    }
                );


                it(
                    'returns null when another worker already owns the lease',
                    async () => {

                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                null
                            );


                        const result =
                            await repository.claim({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                workerId:
                                    'worker-b',

                                leaseMs:
                                    30000

                            });


                        expect(
                            result
                        ).toBeNull();


                        expect(
                            repository.metrics?.counter
                        ).toHaveBeenCalledWith(
                            'distributed_transaction_repository_claim_conflict_total'
                        );

                    }
                );


                it(
                    'supports re-claim by the same worker',
                    async () => {

                        const claimed =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                workerId:
                                    WORKER_ID

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                claimed
                            );


                        const result =
                            await repository.claim({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                workerId:
                                    WORKER_ID

                            });


                        expect(
                            result
                        ).toBe(
                            claimed
                        );


                        const filter =
                            model.findOneAndUpdate
                                .mock.calls[0][0];


                        expect(
                            filter.$or
                        ).toEqual(
                            expect.arrayContaining([
                                {
                                    workerId:
                                        WORKER_ID
                                }
                            ])
                        );

                    }
                );

            }
        );


        /**
         * =====================================================================
         * HEARTBEAT / LEASE
         * =====================================================================
         */

        describe(
            'heartbeat()',
            () => {

                it(
                    'renews an active worker lease atomically',
                    async () => {

                        const updated =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                workerId:
                                    WORKER_ID,

                                version:
                                    2

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                updated
                            );


                        const result =
                            await repository.heartbeat({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                workerId:
                                    WORKER_ID,

                                leaseMs:
                                    60000

                            });


                        expect(
                            result
                        ).toBe(
                            updated
                        );


                        const [
                            filter,
                            update
                        ] =
                            model.findOneAndUpdate
                                .mock.calls[0];


                        expect(
                            filter
                        ).toEqual({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            workerId:
                                WORKER_ID,

                            state: {

                                $in: [

                                    TRANSACTION_STATES.RUNNING,

                                    TRANSACTION_STATES.ROLLING_BACK

                                ]

                            }

                        });


                        expect(
                            update.$inc.version
                        ).toBe(1);

                    }
                );

            }
        );


        describe(
            'releaseLease()',
            () => {

                it(
                    'releases the worker lease',
                    async () => {

                        const updated =
                            createDocument({

                                workerId:
                                    undefined,

                                leaseExpiresAt:
                                    undefined

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                updated
                            );


                        const result =
                            await repository.releaseLease({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                workerId:
                                    WORKER_ID

                            });


                        expect(
                            result
                        ).toBe(
                            updated
                        );


                        const [
                            filter,
                            update
                        ] =
                            model.findOneAndUpdate
                                .mock.calls[0];


                        expect(
                            filter
                        ).toEqual({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            workerId:
                                WORKER_ID

                        });


                        expect(
                            update.$unset
                        ).toEqual({

                            workerId:
                                1,

                            leaseExpiresAt:
                                1,

                            lastHeartbeatAt:
                                1

                        });

                    }
                );

            }
        );


        /**
         * =====================================================================
         * COMPLETE
         * =====================================================================
         */

        describe(
            'complete()',
            () => {

                it(
                    'marks a saga as committed',
                    async () => {

                        const completed =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.COMMITTED,

                                finishedAt:
                                    new Date()

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                completed
                            );


                        const result =
                            await repository.complete({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                result: {

                                    success:
                                        true

                                },

                                expectedVersion:
                                    4

                            });


                        expect(
                            result
                        ).toBe(
                            completed
                        );


                        const [
                            filter,
                            update
                        ] =
                            model.findOneAndUpdate
                                .mock.calls[0];


                        expect(
                            filter.version
                        ).toBe(4);


                        expect(
                            update.$set.state
                        ).toBe(
                            TRANSACTION_STATES.COMMITTED
                        );


                        expect(
                            update.$set.compensationState
                        ).toBe(
                            COMPENSATION_STATES.NOT_REQUIRED
                        );


                        expect(
                            update.$set.commitResult
                        ).toEqual({

                            success:
                                true

                        });

                    }
                );

            }
        );


        /**
         * =====================================================================
         * FAIL
         * =====================================================================
         */

        describe(
            'fail()',
            () => {

                it(
                    'persists terminal failure state',
                    async () => {

                        const failed =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.FAILED

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                failed
                            );


                        const error = {

                            code:
                                'AIRTEL_TIMEOUT',

                            category:
                                'TIMEOUT',

                            message:
                                'Airtel request timed out',

                            retryable:
                                true

                        };


                        const result =
                            await repository.fail({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                error

                            });


                        expect(
                            result
                        ).toBe(
                            failed
                        );


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.state
                        ).toBe(
                            TRANSACTION_STATES.FAILED
                        );


                        expect(
                            update.$set.failure
                        ).toMatchObject({

                            code:
                                'AIRTEL_TIMEOUT',

                            category:
                                'TIMEOUT',

                            message:
                                'Airtel request timed out',

                            retryable:
                                true

                        });

                    }
                );

            }
        );


        /**
         * =====================================================================
         * ROLLBACK
         * =====================================================================
         */

        describe(
            'rollback()',
            () => {

                it(
                    'persists fully compensated rollback',
                    async () => {

                        const rolledBack =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.ROLLED_BACK,

                                compensationState:
                                    COMPENSATION_STATES.COMPLETED

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                rolledBack
                            );


                        const result =
                            await repository.rollback({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                originalError: {

                                    code:
                                        'PAYMENT_FAILED',

                                    message:
                                        'Payment failed'

                                },

                                failures: [],

                                result: {

                                    rolledBack:
                                        true

                                }

                            });


                        expect(
                            result
                        ).toBe(
                            rolledBack
                        );


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.state
                        ).toBe(
                            TRANSACTION_STATES.ROLLED_BACK
                        );


                        expect(
                            update.$set.compensationState
                        ).toBe(
                            COMPENSATION_STATES.COMPLETED
                        );


                        expect(
                            update.$set.compensationFailureCount
                        ).toBe(0);

                    }
                );


                it(
                    'persists compensation failure separately from original failure',
                    async () => {

                        const compensationFailed =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.COMPENSATION_FAILED,

                                compensationState:
                                    COMPENSATION_STATES.FAILED

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                compensationFailed
                            );


                        const result =
                            await repository.rollback({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                originalError: {

                                    code:
                                        'PROVIDER_FAILURE',

                                    message:
                                        'Provider failed'

                                },

                                failures: [

                                    {

                                        operationId:
                                            'op-001',

                                        operation:
                                            'Airtel reversal',

                                        error: {

                                            code:
                                                'REVERSAL_FAILED',

                                            message:
                                                'Compensation provider failed'

                                        }

                                    }

                                ],

                                result: {

                                    rolledBack:
                                        false

                                }

                            });


                        expect(
                            result
                        ).toBe(
                            compensationFailed
                        );


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.state
                        ).toBe(
                            TRANSACTION_STATES.COMPENSATION_FAILED
                        );


                        expect(
                            update.$set.compensationState
                        ).toBe(
                            COMPENSATION_STATES.FAILED
                        );


                        expect(
                            update.$set.compensationFailures
                        ).toHaveLength(1);


                        expect(
                            update.$set.compensationFailureCount
                        ).toBe(1);

                    }
                );

            }
        );


        /**
         * =====================================================================
         * OPERATION LIFECYCLE
         * =====================================================================
         */

        describe(
            'operation lifecycle',
            () => {

                let document;


                beforeEach(
                    () => {

                        document =
                            createDocument({

                                operations: [

                                    {

                                        operationId:
                                            'op-001',

                                        name:
                                            'Airtel Collection',

                                        state:
                                            OPERATION_STATES.PENDING,

                                        attemptCount:
                                            0

                                    }

                                ]

                            });


                    }
                );


                it(
                    'marks an operation running',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        const result =
                            await repository.markOperationRunning({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                operationId:
                                    'op-001',

                                attemptCount:
                                    1

                            });


                        expect(
                            result
                        ).toBe(
                            document
                        );


                        expect(
                            document.operations[0].state
                        ).toBe(
                            OPERATION_STATES.RUNNING
                        );


                        expect(
                            document.operations[0].attemptCount
                        ).toBe(1);


                        expect(
                            document.save
                        ).toHaveBeenCalledTimes(1);

                    }
                );


                it(
                    'marks an operation completed and creates completedOperation record',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        const result =
                            await repository.markOperationCompleted({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                operationId:
                                    'op-001',

                                resultSummary: {

                                    providerStatus:
                                        'SUCCESS'

                                },

                                attemptCount:
                                    2,

                                durationMs:
                                    150

                            });


                        expect(
                            result
                        ).toBe(
                            document
                        );


                        expect(
                            document.operations[0].state
                        ).toBe(
                            OPERATION_STATES.COMPLETED
                        );


                        expect(
                            document.completedOperations
                        ).toHaveLength(1);


                        expect(
                            document.completedOperations[0]
                                .operationId
                        ).toBe(
                            'op-001'
                        );


                        expect(
                            document.completedOperationCount
                        ).toBe(1);

                    }
                );


                it(
                    'does not duplicate completedOperation records',
                    async () => {

                        document.completedOperations =
                            [

                                {

                                    operationId:
                                        'op-001',

                                    operationName:
                                        'Airtel Collection',

                                    completedAt:
                                        new Date()

                                }

                            ];


                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        await repository.markOperationCompleted({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            operationId:
                                'op-001'

                        });


                        expect(
                            document.completedOperations
                        ).toHaveLength(1);

                    }
                );


                it(
                    'marks an operation failed',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        await repository.markOperationFailed({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            operationId:
                                'op-001',

                            error: {

                                code:
                                    'PROVIDER_TIMEOUT',

                                message:
                                    'Provider timed out'

                            },

                            retryable:
                                true

                        });


                        expect(
                            document.operations[0].state
                        ).toBe(
                            OPERATION_STATES.FAILED
                        );


                        expect(
                            document.operations[0].failure
                        ).toMatchObject({

                            code:
                                'PROVIDER_TIMEOUT',

                            retryable:
                                true

                        });

                    }
                );


                it(
                    'marks an operation compensated',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        await repository.markOperationCompensated({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            operationId:
                                'op-001'

                        });


                        expect(
                            document.operations[0].state
                        ).toBe(
                            OPERATION_STATES.COMPENSATED
                        );

                    }
                );


                it(
                    'records compensation failure on the operation and saga',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            document
                                        )

                            });


                        document.save =
                            jest.fn()
                                .mockResolvedValue(
                                    document
                                );


                        await repository.markCompensationFailed({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            operationId:
                                'op-001',

                            error: {

                                code:
                                    'REVERSAL_FAILED',

                                message:
                                    'Unable to compensate provider operation'

                            }

                        });


                        expect(
                            document.operations[0].state
                        ).toBe(
                            OPERATION_STATES.COMPENSATION_FAILED
                        );


                        expect(
                            document.compensationState
                        ).toBe(
                            COMPENSATION_STATES.FAILED
                        );


                        expect(
                            document.compensationFailureCount
                        ).toBe(1);

                    }
                );

            }
        );


        /**
         * =====================================================================
         * RECOVERY QUERIES
         * =====================================================================
         */

        describe(
            'recovery queries',
            () => {

                it(
                    'finds recoverable transactions',
                    async () => {

                        const records = [

                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING

                            }),

                            createDocument({

                                transactionId:
                                    'dtx-002',

                                state:
                                    TRANSACTION_STATES.COMPENSATION_FAILED

                            })

                        ];


                        model.findRecoverable =
                            jest.fn()
                                .mockResolvedValue(
                                    records
                                );


                        const result =
                            await repository.findRecoverable({

                                tenantId:
                                    TENANT_ID,

                                limit:
                                    25

                            });


                        expect(
                            result
                        ).toEqual(
                            records
                        );


                        expect(
                            model.findRecoverable
                        ).toHaveBeenCalledWith({

                            tenantId:
                                TENANT_ID,

                            limit:
                                25,

                            now:
                                expect.any(Date)

                        });

                    }
                );


                it(
                    'finds active transactions',
                    async () => {

                        const records = [

                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING

                            })

                        ];


                        model.findActive =
                            jest.fn()
                                .mockResolvedValue(
                                    records
                                );


                        const result =
                            await repository.findActive({

                                tenantId:
                                    TENANT_ID

                            });


                        expect(
                            result
                        ).toEqual(
                            records
                        );


                        expect(
                            model.findActive
                        ).toHaveBeenCalledWith({

                            tenantId:
                                TENANT_ID,

                            limit:
                                100

                        });

                    }
                );


                it(
                    'finds expired worker leases',
                    async () => {

                        const records = [

                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                leaseExpiresAt:
                                    new Date(
                                        Date.now() -
                                        1000
                                    )

                            })

                        ];


                        model.find
                            .mockReturnValueOnce({

                                sort:
                                    jest.fn()
                                        .mockReturnThis(),

                                limit:
                                    jest.fn()
                                        .mockResolvedValue(
                                            records
                                        )

                            });


                        const result =
                            await repository.findExpiredLeases({

                                tenantId:
                                    TENANT_ID,

                                limit:
                                    10

                            });


                        expect(
                            result
                        ).toEqual(
                            records
                        );


                        expect(
                            model.find
                        ).toHaveBeenCalledWith(
                            expect.objectContaining({

                                tenantId:
                                    TENANT_ID,

                                leaseExpiresAt:
                                    expect.objectContaining({

                                        $lte:
                                            expect.any(Date)

                                    }),

                                state:
                                    expect.objectContaining({

                                        $in:
                                            expect.arrayContaining([

                                                TRANSACTION_STATES.RUNNING,

                                                TRANSACTION_STATES.ROLLING_BACK,

                                                TRANSACTION_STATES.COMPENSATION_FAILED

                                            ])

                                    })

                            })
                        );

                    }
                );


                it(
                    'finds compensation failures requiring recovery',
                    async () => {

                        const records = [

                            createDocument({

                                state:
                                    TRANSACTION_STATES.COMPENSATION_FAILED,

                                compensationState:
                                    COMPENSATION_STATES.FAILED

                            })

                        ];


                        model.find
                            .mockReturnValueOnce({

                                sort:
                                    jest.fn()
                                        .mockReturnThis(),

                                limit:
                                    jest.fn()
                                        .mockResolvedValue(
                                            records
                                        )

                            });


                        const result =
                            await repository.findCompensationFailures({

                                tenantId:
                                    TENANT_ID,

                                limit:
                                    20

                            });


                        expect(
                            result
                        ).toEqual(
                            records
                        );


                        expect(
                            model.find
                        ).toHaveBeenCalledWith(
                            expect.objectContaining({

                                tenantId:
                                    TENANT_ID,

                                state:
                                    TRANSACTION_STATES.COMPENSATION_FAILED,

                                compensationState:
                                    expect.objectContaining({

                                        $in:
                                            [

                                                COMPENSATION_STATES.FAILED,

                                                COMPENSATION_STATES.PARTIAL

                                            ]

                                    })

                            })
                        );

                    }
                );

            }
        );


        /**
         * =====================================================================
         * RECOVERY SCHEDULING
         * =====================================================================
         */

        describe(
            'recovery scheduling',
            () => {

                it(
                    'schedules recovery',
                    async () => {

                        const scheduled =
                            createDocument({

                                nextRecoveryAt:
                                    new Date(
                                        Date.now() +
                                        60000
                                    )

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                scheduled
                            );


                        const nextRecoveryAt =
                            new Date(
                                Date.now() +
                                60000
                            );


                        const result =
                            await repository.scheduleRecovery({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                nextRecoveryAt,

                                reason:
                                    'Provider retry required'

                            });


                        expect(
                            result
                        ).toBe(
                            scheduled
                        );


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.nextRecoveryAt
                        ).toBe(
                            nextRecoveryAt
                        );


                        expect(
                            update.$set.recoveryReason
                        ).toBe(
                            'Provider retry required'
                        );

                    }
                );


                it(
                    'clears a scheduled recovery',
                    async () => {

                        const cleared =
                            createDocument({

                                nextRecoveryAt:
                                    null

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce(
                                cleared
                            );


                        const result =
                            await repository.clearRecoverySchedule({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID

                            });


                        expect(
                            result
                        ).toBe(
                            cleared
                        );


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.nextRecoveryAt
                        ).toBeNull();


                        expect(
                            update.$set.recoveryReason
                        ).toBeNull();

                    }
                );

            }
        );


        /**
         * =====================================================================
         * HEALTH
         * =====================================================================
         */

        describe(
            'health()',
            () => {

                it(
                    'reports UP when repository is reachable',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                select:
                                    jest.fn()
                                        .mockReturnThis(),

                                lean:
                                    jest.fn()
                                        .mockReturnThis(),

                                limit:
                                    jest.fn()
                                        .mockResolvedValue(
                                            {
                                                _id:
                                                    'health-check'
                                            }
                                        )

                            });


                        const health =
                            await repository.health();


                        expect(
                            health.status
                        ).toBe(
                            'UP'
                        );


                        expect(
                            health.repository
                        ).toBe(
                            'DistributedTransactionRepository'
                        );

                    }
                );


                it(
                    'reports DOWN when repository access fails',
                    async () => {

                        model.findOne
                            .mockReturnValueOnce({

                                select:
                                    jest.fn()
                                        .mockReturnThis(),

                                lean:
                                    jest.fn()
                                        .mockReturnThis(),

                                limit:
                                    jest.fn()
                                        .mockRejectedValue(
                                            new Error(
                                                'Mongo unavailable'
                                            )
                                        )

                            });


                        const health =
                            await repository.health();


                        expect(
                            health.status
                        ).toBe(
                            'DOWN'
                        );


                        expect(
                            health.error.message
                        ).toBe(
                            'Mongo unavailable'
                        );

                    }
                );

            }
        );


        /**
         * =====================================================================
         * SECURITY / SANITIZATION
         * =====================================================================
         */

        describe(
            'security controls',
            () => {

                it(
                    'redacts sensitive metadata',
                    async () => {

                        mockFindOne(
                            null
                        );

                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            null
                                        )

                            });


                        mockCreateResult(
                            createDocument()
                        );


                        await repository.create({

                            tenantId:
                                TENANT_ID,

                            transactionId:
                                TRANSACTION_ID,

                            correlationId:
                                CORRELATION_ID,

                            metadata: {

                                clientSecret:
                                    'super-secret',

                                accessToken:
                                    'token-value',

                                operation:
                                    'collection'

                            }

                        });


                        const payload =
                            model.create
                                .mock.calls[0][0];


                        expect(
                            payload.metadata.clientSecret
                        ).toBe(
                            '[REDACTED]'
                        );


                        expect(
                            payload.metadata.accessToken
                        ).toBe(
                            '[REDACTED]'
                        );


                        expect(
                            payload.metadata.operation
                        ).toBe(
                            'collection'
                        );

                    }
                );

            }
        );


        /**
         * =====================================================================
         * MANAGER SNAPSHOT
         * =====================================================================
         */

        describe(
            'save() manager compatibility',
            () => {

                it(
                    'creates a record from a manager snapshot',
                    async () => {

                        /**
                         * First findOne() from save().
                         */
                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            null
                                        )

                            });


                        /**
                         * create() must be mocked separately because save()
                         * delegates to create().
                         */
                        model.create
                            .mockResolvedValueOnce(
                                createDocument({

                                    state:
                                        TRANSACTION_STATES.RUNNING

                                })
                            );


                        const result =
                            await repository.save({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID,

                                requestId:
                                    REQUEST_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY,

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                operations: [

                                    {

                                        id:
                                            'op-001',

                                        name:
                                            'Ledger',

                                        timeout:
                                            5000,

                                        retries:
                                            1

                                    }

                                ],

                                completed: [],

                                history: []

                            });


                        expect(
                            result
                        ).toBeDefined();


                        expect(
                            model.create
                        ).toHaveBeenCalledTimes(1);


                        const payload =
                            model.create
                                .mock.calls[0][0];


                        expect(
                            payload.state
                        ).toBe(
                            TRANSACTION_STATES.RUNNING
                        );


                        expect(
                            payload.operationCount
                        ).toBe(1);

                    }
                );


                it(
                    'updates an existing record from a manager snapshot',
                    async () => {

                        const existing =
                            createDocument({

                                state:
                                    TRANSACTION_STATES.RUNNING,

                                version:
                                    3

                            });


                        model.findOne
                            .mockReturnValueOnce({

                                exec:
                                    jest.fn()
                                        .mockResolvedValue(
                                            existing
                                        )

                            });


                        model.findOneAndUpdate
                            .mockResolvedValueOnce({

                                ...existing,

                                state:
                                    TRANSACTION_STATES.COMMITTED,

                                version:
                                    4

                            });


                        const result =
                            await repository.save({

                                tenantId:
                                    TENANT_ID,

                                transactionId:
                                    TRANSACTION_ID,

                                correlationId:
                                    CORRELATION_ID,

                                requestId:
                                    REQUEST_ID,

                                idempotencyKey:
                                    IDEMPOTENCY_KEY,

                                state:
                                    TRANSACTION_STATES.COMMITTED,

                                operations: [],

                                completed: [],

                                history: [],

                                commitResult: {

                                    success:
                                        true

                                }

                            });


                        expect(
                            result.state
                        ).toBe(
                            TRANSACTION_STATES.COMMITTED
                        );


                        expect(
                            model.findOneAndUpdate
                        ).toHaveBeenCalledTimes(1);


                        const update =
                            model.findOneAndUpdate
                                .mock.calls[0][1];


                        expect(
                            update.$set.state
                        ).toBe(
                            TRANSACTION_STATES.COMMITTED
                        );


                        expect(
                            update.$inc.version
                        ).toBe(1);

                    }
                );

            }
        );


    }
);