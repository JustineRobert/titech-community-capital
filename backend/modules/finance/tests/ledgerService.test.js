/**
 * ============================================================================
 * TITech Community Capital LTD
 * ledgerService.test.js
 * ============================================================================
 *
 * Enterprise Jest Test Suite — Ledger Service
 *
 * Financial invariants covered:
 *
 *  - Input validation
 *  - Monetary amount validation
 *  - Tenant isolation
 *  - Idempotency
 *  - Duplicate transaction protection
 *  - Transaction persistence
 *  - Ledger entry persistence
 *  - Double-entry balancing
 *  - Debit / credit account updates
 *  - MongoDB session propagation
 *  - MongoDB transaction lifecycle
 *  - Commit handling
 *  - Rollback handling
 *  - Session cleanup
 *  - Persistence failure handling
 *  - Commit failure handling
 *  - Ledger failure handling
 *  - Account update failure handling
 *  - Balanced transaction enforcement
 *  - Self-transfer protection
 *  - Decimal monetary values
 *  - Invalid numeric values
 *  - Operational invariants
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const ledgerService =
    require('../services/ledgerService');

const Account =
    require('../models/Account');

const LedgerEntry =
    require('../models/LedgerEntry');

const Transaction =
    require('../models/Transaction');

const {
    checkDuplicate
} = require('../utils/idempotency');

jest.mock('../models/Account');
jest.mock('../models/LedgerEntry');
jest.mock('../models/Transaction');
jest.mock('../utils/idempotency');

describe('Ledger Service — Enterprise Financial Invariants', () => {

    let session;
    let originalStartSession;

    const baseTransaction = {
        tenantId: 'tenant-001',
        debitAccountId: 'account-debit',
        creditAccountId: 'account-credit',
        amount: 100,
        reference: 'reference-001',
        description: 'Enterprise ledger test'
    };

    /**
     * =========================================================================
     * Helpers
     * =========================================================================
     */

    const createSession = () => ({

        startTransaction:
            jest.fn(),

        commitTransaction:
            jest.fn().mockResolvedValue(),

        abortTransaction:
            jest.fn().mockResolvedValue(),

        endSession:
            jest.fn().mockResolvedValue()

    });

    const execute = (
        overrides = {}
    ) =>
        ledgerService.postTransaction({
            ...baseTransaction,
            ...overrides
        });

    /**
     * =========================================================================
     * Setup
     * =========================================================================
     */

    beforeEach(() => {

        jest.clearAllMocks();

        originalStartSession =
            mongoose.startSession;

        session =
            createSession();

        mongoose.startSession =
            jest.fn()
                .mockResolvedValue(session);

        checkDuplicate
            .mockResolvedValue(false);

        Transaction.create
            .mockResolvedValue([

                {
                    _id: 'tx123',

                    save:
                        jest.fn()
                            .mockResolvedValue()
                }

            ]);

        LedgerEntry.create
            .mockResolvedValue({

                _id: 'ledger-entry-001'

            });

        Account.findByIdAndUpdate
            .mockResolvedValue({

                _id: 'account'

            });

    });

    /**
     * =========================================================================
     * Cleanup
     * =========================================================================
     */

    afterEach(() => {

        mongoose.startSession =
            originalStartSession;

        jest.restoreAllMocks();

    });

    /**
     * =========================================================================
     * postTransaction
     * =========================================================================
     */

    describe('postTransaction()', () => {

        /**
         * ---------------------------------------------------------------------
         * Successful posting
         * ---------------------------------------------------------------------
         */

        it(
            'posts a transaction atomically and commits successfully',
            async () => {

                const result =
                    await execute();

                expect(result)
                    .toEqual({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });

                expect(
                    checkDuplicate
                ).toHaveBeenCalledWith(
                    baseTransaction.reference
                );

                expect(
                    mongoose.startSession
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.startTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    Transaction.create
                ).toHaveBeenCalledTimes(1);

                expect(
                    LedgerEntry.create
                ).toHaveBeenCalledTimes(1);

                expect(
                    Account.findByIdAndUpdate
                ).toHaveBeenCalledTimes(2);

                expect(
                    session.commitTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.abortTransaction
                ).not.toHaveBeenCalled();

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Tenant propagation
         * ---------------------------------------------------------------------
         */

        it(
            'propagates tenant identity into the transaction payload',
            async () => {

                await execute({

                    tenantId:
                        'tenant-production'

                });

                const call =
                    Transaction.create
                        .mock.calls[0];

                expect(call)
                    .toBeDefined();

                const payload =
                    call[0];

                expect(payload)
                    .toEqual(
                        expect.objectContaining({

                            tenantId:
                                'tenant-production'

                        })
                    );

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Tenant isolation
         * ---------------------------------------------------------------------
         */

        it(
            'does not silently replace the supplied tenant identity',
            async () => {

                await execute({

                    tenantId:
                        'tenant-A'

                });

                const payload =
                    Transaction.create
                        .mock.calls[0][0];

                expect(
                    payload.tenantId
                ).toBe('tenant-A');

                expect(
                    payload.tenantId
                ).not.toBe('tenant-B');

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Session propagation
         * ---------------------------------------------------------------------
         */

        it(
            'propagates the MongoDB session to persistence operations',
            async () => {

                await execute();

                const transactionArgs =
                    Transaction.create.mock.calls[0];

                const ledgerArgs =
                    LedgerEntry.create.mock.calls[0];

                const accountCalls =
                    Account.findByIdAndUpdate.mock.calls;

                /**
                 * Depending on the service implementation,
                 * session may be passed through an options object.
                 */
                expect(
                    JSON.stringify(transactionArgs)
                ).toContain(
                    JSON.stringify(session)
                );

                expect(
                    JSON.stringify(ledgerArgs)
                ).toContain(
                    JSON.stringify(session)
                );

                expect(
                    accountCalls.length
                ).toBe(2);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Positive amount
         * ---------------------------------------------------------------------
         */

        it(
            'accepts a positive monetary amount',
            async () => {

                const result =
                    await execute({

                        amount:
                            100

                    });

                expect(result.success)
                    .toBe(true);

                expect(
                    Transaction.create
                ).toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Negative amount
         * ---------------------------------------------------------------------
         */

        it(
            'rejects negative amounts before persistence',
            async () => {

                await expect(

                    execute({

                        amount:
                            -10

                    })

                ).rejects.toThrow(
                    'Amount must be a positive number'
                );

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

                expect(
                    LedgerEntry.create
                ).not.toHaveBeenCalled();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

                expect(
                    mongoose.startSession
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Zero amount
         * ---------------------------------------------------------------------
         */

        it(
            'rejects zero-value transactions',
            async () => {

                await expect(

                    execute({

                        amount:
                            0

                    })

                ).rejects.toThrow(
                    'Amount must be a positive number'
                );

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * NaN
         * ---------------------------------------------------------------------
         */

        it(
            'rejects NaN amounts',
            async () => {

                await expect(

                    execute({

                        amount:
                            NaN

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Infinity
         * ---------------------------------------------------------------------
         */

        it(
            'rejects infinite amounts',
            async () => {

                await expect(

                    execute({

                        amount:
                            Infinity

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Decimal amount
         * ---------------------------------------------------------------------
         */

        it(
            'supports valid decimal monetary values',
            async () => {

                const result =
                    await execute({

                        amount:
                            100.25

                    });

                expect(result)
                    .toEqual({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Missing tenant
         * ---------------------------------------------------------------------
         */

        it(
            'rejects missing tenant identity',
            async () => {

                await expect(

                    execute({

                        tenantId:
                            undefined

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Missing debit account
         * ---------------------------------------------------------------------
         */

        it(
            'rejects missing debit account',
            async () => {

                await expect(

                    execute({

                        debitAccountId:
                            undefined

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Missing credit account
         * ---------------------------------------------------------------------
         */

        it(
            'rejects missing credit account',
            async () => {

                await expect(

                    execute({

                        creditAccountId:
                            undefined

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Self-transfer
         * ---------------------------------------------------------------------
         */

        it(
            'rejects transactions where debit and credit accounts are identical',
            async () => {

                await expect(

                    execute({

                        debitAccountId:
                            'same-account',

                        creditAccountId:
                            'same-account'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Missing reference
         * ---------------------------------------------------------------------
         */

        it(
            'rejects missing transaction references',
            async () => {

                await expect(

                    execute({

                        reference:
                            undefined

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Duplicate transaction
         * ---------------------------------------------------------------------
         */

        it(
            'prevents duplicate financial posting',
            async () => {

                checkDuplicate
                    .mockResolvedValue(true);

                const result =
                    await execute({

                        reference:
                            'duplicate-reference'

                    });

                expect(
                    checkDuplicate
                ).toHaveBeenCalledWith(
                    'duplicate-reference'
                );

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

                expect(
                    LedgerEntry.create
                ).not.toHaveBeenCalled();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

                expect(
                    mongoose.startSession
                ).not.toHaveBeenCalled();

                expect(
                    session.commitTransaction
                ).not.toHaveBeenCalled();

                expect(result)
                    .toBeDefined();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Persistence failure
         * ---------------------------------------------------------------------
         */

        it(
            'aborts when transaction persistence fails',
            async () => {

                Transaction.create
                    .mockRejectedValue(
                        new Error(
                            'Database persistence failure'
                        )
                    );

                await expect(

                    execute()

                ).rejects.toThrow(
                    'Database persistence failure'
                );

                expect(
                    session.startTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.abortTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.commitTransaction
                ).not.toHaveBeenCalled();

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Ledger persistence failure
         * ---------------------------------------------------------------------
         */

        it(
            'aborts when ledger entry persistence fails',
            async () => {

                LedgerEntry.create
                    .mockRejectedValue(
                        new Error(
                            'Ledger entry persistence failure'
                        )
                    );

                await expect(

                    execute()

                ).rejects.toThrow(
                    'Ledger entry persistence failure'
                );

                expect(
                    session.abortTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.commitTransaction
                ).not.toHaveBeenCalled();

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Debit account failure
         * ---------------------------------------------------------------------
         */

        it(
            'aborts when account balance update fails',
            async () => {

                Account.findByIdAndUpdate
                    .mockRejectedValue(
                        new Error(
                            'Account balance update failure'
                        )
                    );

                await expect(

                    execute()

                ).rejects.toThrow(
                    'Account balance update failure'
                );

                expect(
                    session.abortTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.commitTransaction
                ).not.toHaveBeenCalled();

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Commit failure
         * ---------------------------------------------------------------------
         */

        it(
            'does not report success when commit fails',
            async () => {

                session.commitTransaction
                    .mockRejectedValue(
                        new Error(
                            'Commit failed'
                        )
                    );

                await expect(

                    execute()

                ).rejects.toThrow(
                    'Commit failed'
                );

                expect(
                    session.commitTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Abort failure
         * ---------------------------------------------------------------------
         */

        it(
            'still releases the session when rollback itself fails',
            async () => {

                Transaction.create
                    .mockRejectedValue(
                        new Error(
                            'Primary persistence failure'
                        )
                    );

                session.abortTransaction
                    .mockRejectedValue(
                        new Error(
                            'Rollback failure'
                        )
                    );

                await expect(

                    execute()

                ).rejects.toThrow();

                expect(
                    session.abortTransaction
                ).toHaveBeenCalledTimes(1);

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * No commit after failure
         * ---------------------------------------------------------------------
         */

        it(
            'never commits after a persistence failure',
            async () => {

                LedgerEntry.create
                    .mockRejectedValue(
                        new Error(
                            'Ledger failure'
                        )
                    );

                await expect(
                    execute()
                ).rejects.toThrow();

                expect(
                    session.commitTransaction
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Two account updates
         * ---------------------------------------------------------------------
         */

        it(
            'updates both debit and credit accounts',
            async () => {

                await execute({

                    amount:
                        250

                });

                expect(
                    Account.findByIdAndUpdate
                ).toHaveBeenCalledTimes(2);

                const calls =
                    Account.findByIdAndUpdate.mock.calls;

                expect(
                    calls[0][0]
                ).toBe(
                    'acc-debit'
                );

                expect(
                    calls[1][0]
                ).toBe(
                    'acc-credit'
                );

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Account update amount
         * ---------------------------------------------------------------------
         */

        it(
            'uses the transaction amount when updating account balances',
            async () => {

                await execute({

                    amount:
                        325.75

                });

                const calls =
                    Account.findByIdAndUpdate.mock.calls;

                const serialized =
                    JSON.stringify(calls);

                expect(serialized)
                    .toContain('325.75');

            }
        );

    });

    /**
     * =========================================================================
     * recordBalancedTransaction()
     * =========================================================================
     */

    describe('recordBalancedTransaction()', () => {

        /**
         * ---------------------------------------------------------------------
         * Balanced posting
         * ---------------------------------------------------------------------
         */

        it(
            'delegates balanced transactions to postTransaction',
            async () => {

                const result =
                    await ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            250,

                        creditAmount:
                            250,

                        reference:
                            'balanced-001',

                        description:
                            'Balanced transaction'

                    });

                expect(
                    Transaction.create
                ).toHaveBeenCalledTimes(1);

                expect(
                    LedgerEntry.create
                ).toHaveBeenCalledTimes(1);

                expect(
                    Account.findByIdAndUpdate
                ).toHaveBeenCalledTimes(2);

                expect(
                    session.commitTransaction
                ).toHaveBeenCalledTimes(1);

                expect(result)
                    .toEqual({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Unbalanced transaction
         * ---------------------------------------------------------------------
         */

        it(
            'rejects unbalanced debit and credit amounts',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            100,

                        creditAmount:
                            200,

                        reference:
                            'unbalanced-001',

                        description:
                            'Unbalanced transaction'

                    })

                ).rejects.toThrow(
                    'Ledger imbalance: debit and credit amounts must be equal'
                );

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

                expect(
                    LedgerEntry.create
                ).not.toHaveBeenCalled();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

                expect(
                    mongoose.startSession
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Negative debit
         * ---------------------------------------------------------------------
         */

        it(
            'rejects negative debit amounts',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            -100,

                        creditAmount:
                            -100,

                        reference:
                            'negative-001',

                        description:
                            'Negative amounts'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Zero balanced amount
         * ---------------------------------------------------------------------
         */

        it(
            'rejects zero-value balanced transactions',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            0,

                        creditAmount:
                            0,

                        reference:
                            'zero-balanced-001',

                        description:
                            'Zero balanced amount'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Decimal equality
         * ---------------------------------------------------------------------
         */

        it(
            'accepts equal decimal monetary amounts',
            async () => {

                const result =
                    await ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            100.25,

                        creditAmount:
                            100.25,

                        reference:
                            'decimal-001',

                        description:
                            'Decimal transaction'

                    });

                expect(result)
                    .toEqual({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });

                expect(
                    Transaction.create
                ).toHaveBeenCalledTimes(1);

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Decimal imbalance
         * ---------------------------------------------------------------------
         */

        it(
            'rejects decimal imbalance',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            100.25,

                        creditAmount:
                            100.24,

                        reference:
                            'decimal-imbalance-001',

                        description:
                            'Decimal imbalance'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * NaN balanced values
         * ---------------------------------------------------------------------
         */

        it(
            'rejects NaN balanced amounts',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            NaN,

                        creditAmount:
                            NaN,

                        reference:
                            'nan-balanced-001',

                        description:
                            'NaN transaction'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

        /**
         * ---------------------------------------------------------------------
         * Infinity balanced values
         * ---------------------------------------------------------------------
         */

        it(
            'rejects infinite balanced amounts',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'account-debit',

                        creditAccountId:
                            'account-credit',

                        debitAmount:
                            Infinity,

                        creditAmount:
                            Infinity,

                        reference:
                            'infinity-balanced-001',

                        description:
                            'Infinite transaction'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

            }
        );

    });

    /**
     * =========================================================================
     * Financial invariants
     * =========================================================================
     */

    describe('financial invariants', () => {

        it(
            'never persists an unbalanced transaction',
            async () => {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            'tenant-001',

                        debitAccountId:
                            'debit',

                        creditAccountId:
                            'credit',

                        debitAmount:
                            99.99,

                        creditAmount:
                            100,

                        reference:
                            'invariant-001',

                        description:
                            'Invariant test'

                    })

                ).rejects.toThrow();

                expect(
                    Transaction.create
                ).not.toHaveBeenCalled();

                expect(
                    LedgerEntry.create
                ).not.toHaveBeenCalled();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

            }
        );

        it(
            'does not update balances when transaction creation fails',
            async () => {

                Transaction.create
                    .mockRejectedValue(
                        new Error(
                            'Transaction creation failed'
                        )
                    );

                await expect(
                    execute()
                ).rejects.toThrow();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

            }
        );

        it(
            'does not update balances when ledger persistence fails',
            async () => {

                LedgerEntry.create
                    .mockRejectedValue(
                        new Error(
                            'Ledger persistence failed'
                        )
                    );

                await expect(
                    execute()
                ).rejects.toThrow();

                expect(
                    Account.findByIdAndUpdate
                ).not.toHaveBeenCalled();

            }
        );

    });

    /**
     * =========================================================================
     * Transaction lifecycle invariants
     * =========================================================================
     */

    describe('MongoDB transaction lifecycle', () => {

        it(
            'starts exactly one session per financial posting',
            async () => {

                await execute();

                expect(
                    mongoose.startSession
                ).toHaveBeenCalledTimes(1);

            }
        );

        it(
            'starts the transaction before persistence',
            async () => {

                const order = [];

                session.startTransaction
                    .mockImplementation(() => {

                        order.push(
                            'start'
                        );

                    });

                Transaction.create
                    .mockImplementation(async () => {

                        order.push(
                            'transaction-create'
                        );

                        return [
                            {
                                _id:
                                    'tx123'
                            }
                        ];

                    });

                await execute();

                expect(order)
                    .toEqual([

                        'start',

                        'transaction-create'

                    ]);

            }
        );

        it(
            'commits only after all persistence operations succeed',
            async () => {

                const order = [];

                Transaction.create
                    .mockImplementation(async () => {

                        order.push(
                            'transaction'
                        );

                        return [
                            {
                                _id:
                                    'tx123'
                            }
                        ];

                    });

                LedgerEntry.create
                    .mockImplementation(async () => {

                        order.push(
                            'ledger'
                        );

                        return true;

                    });

                Account.findByIdAndUpdate
                    .mockImplementation(async () => {

                        order.push(
                            'account'
                        );

                        return true;

                    });

                session.commitTransaction
                    .mockImplementation(async () => {

                        order.push(
                            'commit'
                        );

                    });

                await execute();

                expect(order)
                    .toEqual([

                        'transaction',

                        'ledger',

                        'account',

                        'account',

                        'commit'

                    ]);

            }
        );

        it(
            'always ends the MongoDB session',
            async () => {

                await execute();

                expect(
                    session.endSession
                ).toHaveBeenCalledTimes(1);

            }
        );

    });

});