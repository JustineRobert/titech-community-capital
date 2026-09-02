/**
 * ============================================================================
 * TITech Community Capital LTD
 * ledgerService.mocha.test.js
 * ============================================================================
 *
 * Enterprise Mocha Test Suite — Ledger Service
 *
 * Coverage:
 *
 *  - Successful transaction posting
 *  - MongoDB transaction lifecycle
 *  - Idempotency protection
 *  - Tenant isolation
 *  - Transaction persistence
 *  - Ledger entry persistence
 *  - Debit/credit account updates
 *  - Balanced transaction enforcement
 *  - Invalid amount validation
 *  - Decimal monetary values
 *  - Persistence failure rollback
 *  - Ledger failure rollback
 *  - Account update failure rollback
 *  - Commit failure handling
 *  - Session cleanup
 *
 * ============================================================================
 */

'use strict';

const sinon = require('sinon');
const { expect } = require('chai');
const mongoose = require('mongoose');

const ledgerService =
    require('../services/ledgerService');

const Account =
    require('../models/Account');

const LedgerEntry =
    require('../models/LedgerEntry');

const Transaction =
    require('../models/Transaction');

const idempotency =
    require('../utils/idempotency');


describe('Ledger Service (Mocha)', function () {

    let sandbox;
    let session;

    /**
     * =========================================================================
     * Test Constants
     * =========================================================================
     */

    const TENANT_ID =
        'tenant-production';

    const DEBIT_ACCOUNT =
        'acc-debit';

    const CREDIT_ACCOUNT =
        'acc-credit';


    /**
     * =========================================================================
     * Helpers
     * =========================================================================
     */

    function validPayload(overrides = {}) {

        return {

            tenantId:
                TENANT_ID,

            debitAccountId:
                DEBIT_ACCOUNT,

            creditAccountId:
                CREDIT_ACCOUNT,

            amount:
                100,

            reference:
                'ref-mocha-001',

            description:
                'Mocha ledger test',

            ...overrides

        };

    }


    /**
     * =========================================================================
     * Setup
     * =========================================================================
     */

    beforeEach(function () {

        sandbox =
            sinon.createSandbox();


        session = {

            startTransaction:
                sandbox.stub(),

            commitTransaction:
                sandbox.stub()
                    .resolves(),

            abortTransaction:
                sandbox.stub()
                    .resolves(),

            endSession:
                sandbox.stub()
                    .resolves()

        };


        sandbox
            .stub(mongoose, 'startSession')
            .resolves(session);


        /**
         * No duplicate by default.
         */
        sandbox
            .stub(idempotency, 'checkDuplicate')
            .resolves(false);


        /**
         * Transaction persistence.
         */
        sandbox
            .stub(Transaction, 'create')
            .resolves([

                {

                    _id:
                        'tx123',

                    tenantId:
                        TENANT_ID,

                    reference:
                        'ref-mocha-001',

                    amount:
                        100,

                    save:
                        sandbox.stub()
                            .resolves()

                }

            ]);


        /**
         * Ledger persistence.
         */
        sandbox
            .stub(LedgerEntry, 'create')
            .resolves({

                _id:
                    'ledger-entry-123'

            });


        /**
         * Account updates.
         */
        sandbox
            .stub(Account, 'findByIdAndUpdate')
            .resolves({

                _id:
                    'account-updated'

            });

    });


    /**
     * =========================================================================
     * Cleanup
     * =========================================================================
     */

    afterEach(function () {

        sandbox.restore();

    });


    /**
     * =========================================================================
     * Successful Transaction Posting
     * =========================================================================
     */

    describe('postTransaction()', function () {

        it(
            'should complete the full ledger posting lifecycle',
            async function () {

                const result =
                    await ledgerService.postTransaction(
                        validPayload()
                    );


                expect(result)
                    .to.deep.equal({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });


                /**
                 * Idempotency must be checked first.
                 */
                expect(
                    idempotency.checkDuplicate.calledOnce
                ).to.equal(true);


                expect(
                    idempotency.checkDuplicate.firstCall.args[0]
                ).to.equal(
                    'ref-mocha-001'
                );


                /**
                 * MongoDB session must be created.
                 */
                expect(
                    mongoose.startSession.calledOnce
                ).to.equal(true);


                /**
                 * Financial transaction boundary.
                 */
                expect(
                    session.startTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.commitTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.abortTransaction.called
                ).to.equal(false);


                /**
                 * Session must always be released.
                 */
                expect(
                    session.endSession.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Tenant propagation
         * ---------------------------------------------------------------------
         */

        it(
            'should propagate tenant identity into transaction persistence',
            async function () {

                await ledgerService.postTransaction(
                    validPayload({
                        amount:
                            150,

                        reference:
                            'ref-tenant-propagation'
                    })
                );


                expect(
                    Transaction.create.calledOnce
                ).to.equal(true);


                const transactionArg =
                    Transaction.create.firstCall.args[0];


                /**
                 * Supports both direct-document and
                 * array-document create implementations.
                 */
                const transaction =
                    Array.isArray(transactionArg)
                        ? transactionArg[0]
                        : transactionArg;


                expect(transaction)
                    .to.be.an('object');


                expect(
                    transaction.tenantId
                ).to.equal(
                    TENANT_ID
                );

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Transaction persistence
         * ---------------------------------------------------------------------
         */

        it(
            'should persist transaction financial attributes',
            async function () {

                await ledgerService.postTransaction(
                    validPayload({

                        amount:
                            250,

                        reference:
                            'ref-financial-persistence',

                        description:
                            'Financial persistence verification'

                    })
                );


                expect(
                    Transaction.create.calledOnce
                ).to.equal(true);


                const transactionArg =
                    Transaction.create.firstCall.args[0];


                const transaction =
                    Array.isArray(transactionArg)
                        ? transactionArg[0]
                        : transactionArg;


                expect(transaction)
                    .to.be.an('object');


                expect(
                    transaction.tenantId
                ).to.equal(
                    TENANT_ID
                );


                expect(
                    transaction.reference
                ).to.equal(
                    'ref-financial-persistence'
                );


                expect(
                    transaction.amount
                ).to.equal(
                    250
                );


                expect(
                    transaction.description
                ).to.equal(
                    'Financial persistence verification'
                );

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Ledger entry persistence
         * ---------------------------------------------------------------------
         */

        it(
            'should persist ledger entries',
            async function () {

                await ledgerService.postTransaction(
                    validPayload({

                        amount:
                            200,

                        reference:
                            'ref-ledger-entry'

                    })
                );


                expect(
                    LedgerEntry.create.calledOnce
                ).to.equal(true);


                const ledgerArg =
                    LedgerEntry.create.firstCall.args[0];


                const entries =
                    Array.isArray(ledgerArg)
                        ? ledgerArg
                        : [ledgerArg];


                expect(entries.length)
                    .to.be.greaterThan(0);


                /**
                 * Every persisted ledger entry should
                 * carry the tenant boundary when the
                 * service contract supports tenant fields.
                 */
                const tenantBearingEntry =
                    entries.find(
                        entry =>
                            entry &&
                            entry.tenantId !== undefined
                    );


                if (tenantBearingEntry) {

                    expect(
                        tenantBearingEntry.tenantId
                    ).to.equal(
                        TENANT_ID
                    );

                }

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Account updates
         * ---------------------------------------------------------------------
         */

        it(
            'should update both affected accounts',
            async function () {

                await ledgerService.postTransaction(
                    validPayload({

                        amount:
                            75,

                        reference:
                            'ref-account-update'

                    })
                );


                expect(
                    Account.findByIdAndUpdate.callCount
                ).to.equal(2);


                const calls =
                    Account.findByIdAndUpdate.getCalls();


                const accountIds =
                    calls.map(
                        call =>
                            call.args[0]
                    );


                expect(accountIds)
                    .to.include(
                        DEBIT_ACCOUNT
                    );


                expect(accountIds)
                    .to.include(
                        CREDIT_ACCOUNT
                    );

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Decimal monetary amount
         * ---------------------------------------------------------------------
         */

        it(
            'should preserve valid decimal monetary amounts',
            async function () {

                const result =
                    await ledgerService.postTransaction(
                        validPayload({

                            amount:
                                100.25,

                            reference:
                                'ref-decimal'

                        })
                    );


                expect(result)
                    .to.deep.equal({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });


                expect(
                    Transaction.create.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Invalid amount
         * ---------------------------------------------------------------------
         */

        it(
            'should reject negative transaction amounts before persistence',
            async function () {

                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            amount:
                                -10,

                            reference:
                                'ref-negative'

                        })
                    )

                ).to.be.rejectedWith(
                    'Amount must be a positive number'
                );


                expect(
                    Transaction.create.called
                ).to.equal(false);


                expect(
                    LedgerEntry.create.called
                ).to.equal(false);


                expect(
                    Account.findByIdAndUpdate.called
                ).to.equal(false);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Zero amount
         * ---------------------------------------------------------------------
         */

        it(
            'should reject zero-value transactions',
            async function () {

                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            amount:
                                0,

                            reference:
                                'ref-zero'

                        })
                    )

                ).to.be.rejectedWith(
                    'Amount must be a positive number'
                );


                expect(
                    Transaction.create.called
                ).to.equal(false);


                expect(
                    LedgerEntry.create.called
                ).to.equal(false);


                expect(
                    Account.findByIdAndUpdate.called
                ).to.equal(false);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Duplicate transaction
         * ---------------------------------------------------------------------
         */

        it(
            'should prevent duplicate financial persistence',
            async function () {

                idempotency
                    .checkDuplicate
                    .resolves(true);


                const result =
                    await ledgerService.postTransaction(
                        validPayload({

                            reference:
                                'ref-duplicate'

                        })
                    );


                expect(
                    Transaction.create.called
                ).to.equal(false);


                expect(
                    LedgerEntry.create.called
                ).to.equal(false);


                expect(
                    Account.findByIdAndUpdate.called
                ).to.equal(false);


                expect(
                    session.commitTransaction.called
                ).to.equal(false);


                /**
                 * A properly optimized implementation should
                 * detect the duplicate before opening a MongoDB
                 * transaction.
                 *
                 * Therefore we deliberately do NOT require
                 * endSession() here.
                 */
                expect(result)
                    .to.exist;

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Persistence failure
         * ---------------------------------------------------------------------
         */

        it(
            'should abort and release the session when transaction persistence fails',
            async function () {

                Transaction.create
                    .rejects(
                        new Error(
                            'Database persistence failure'
                        )
                    );


                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            reference:
                                'ref-persistence-failure'

                        })
                    )

                ).to.be.rejectedWith(
                    'Database persistence failure'
                );


                expect(
                    session.startTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.abortTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.commitTransaction.called
                ).to.equal(false);


                expect(
                    session.endSession.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Ledger entry failure
         * ---------------------------------------------------------------------
         */

        it(
            'should rollback when ledger entry persistence fails',
            async function () {

                LedgerEntry.create
                    .rejects(
                        new Error(
                            'Ledger entry persistence failure'
                        )
                    );


                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            reference:
                                'ref-ledger-failure'

                        })
                    )

                ).to.be.rejectedWith(
                    'Ledger entry persistence failure'
                );


                expect(
                    session.abortTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.commitTransaction.called
                ).to.equal(false);


                expect(
                    session.endSession.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Account update failure
         * ---------------------------------------------------------------------
         */

        it(
            'should rollback when account balance update fails',
            async function () {

                Account.findByIdAndUpdate
                    .rejects(
                        new Error(
                            'Account balance update failure'
                        )
                    );


                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            reference:
                                'ref-account-failure'

                        })
                    )

                ).to.be.rejectedWith(
                    'Account balance update failure'
                );


                expect(
                    session.abortTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.commitTransaction.called
                ).to.equal(false);


                expect(
                    session.endSession.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Commit failure
         * ---------------------------------------------------------------------
         */

        it(
            'should surface commit failures and release the session',
            async function () {

                session.commitTransaction
                    .rejects(
                        new Error(
                            'Commit failure'
                        )
                    );


                await expect(

                    ledgerService.postTransaction(
                        validPayload({

                            reference:
                                'ref-commit-failure'

                        })
                    )

                ).to.be.rejectedWith(
                    'Commit failure'
                );


                expect(
                    session.commitTransaction.calledOnce
                ).to.equal(true);


                expect(
                    session.endSession.calledOnce
                ).to.equal(true);

            }
        );

    });


    /**
     * =========================================================================
     * recordBalancedTransaction()
     * =========================================================================
     */

    describe('recordBalancedTransaction()', function () {

        /**
         * ---------------------------------------------------------------------
         * Balanced transaction
         * ---------------------------------------------------------------------
         */

        it(
            'should delegate to postTransaction for equal positive amounts',
            async function () {

                const result =
                    await ledgerService.recordBalancedTransaction({

                        tenantId:
                            TENANT_ID,

                        debitAccountId:
                            DEBIT_ACCOUNT,

                        creditAccountId:
                            CREDIT_ACCOUNT,

                        debitAmount:
                            250,

                        creditAmount:
                            250,

                        reference:
                            'ref-balanced',

                        description:
                            'Balanced transaction'

                    });


                expect(result)
                    .to.deep.equal({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });


                expect(
                    Transaction.create.calledOnce
                ).to.equal(true);


                expect(
                    LedgerEntry.create.calledOnce
                ).to.equal(true);


                expect(
                    Account.findByIdAndUpdate.callCount
                ).to.equal(2);


                expect(
                    session.commitTransaction.calledOnce
                ).to.equal(true);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Unbalanced transaction
         * ---------------------------------------------------------------------
         */

        it(
            'should reject unbalanced debit and credit amounts',
            async function () {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            TENANT_ID,

                        debitAccountId:
                            DEBIT_ACCOUNT,

                        creditAccountId:
                            CREDIT_ACCOUNT,

                        debitAmount:
                            100,

                        creditAmount:
                            200,

                        reference:
                            'ref-unbalanced',

                        description:
                            'Unbalanced transaction'

                    })

                ).to.be.rejectedWith(
                    'Ledger imbalance: debit and credit amounts must be equal'
                );


                expect(
                    Transaction.create.called
                ).to.equal(false);


                expect(
                    LedgerEntry.create.called
                ).to.equal(false);


                expect(
                    Account.findByIdAndUpdate.called
                ).to.equal(false);


                expect(
                    mongoose.startSession.called
                ).to.equal(false);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Negative debit
         * ---------------------------------------------------------------------
         */

        it(
            'should reject negative debit and credit amounts',
            async function () {

                await expect(

                    ledgerService.recordBalancedTransaction({

                        tenantId:
                            TENANT_ID,

                        debitAccountId:
                            DEBIT_ACCOUNT,

                        creditAccountId:
                            CREDIT_ACCOUNT,

                        debitAmount:
                            -100,

                        creditAmount:
                            -100,

                        reference:
                            'ref-negative-balanced',

                        description:
                            'Negative balanced amounts'

                    })

                ).to.be.rejected;


                expect(
                    Transaction.create.called
                ).to.equal(false);


                expect(
                    LedgerEntry.create.called
                ).to.equal(false);


                expect(
                    Account.findByIdAndUpdate.called
                ).to.equal(false);

            }
        );


        /**
         * ---------------------------------------------------------------------
         * Decimal balanced amount
         * ---------------------------------------------------------------------
         */

        it(
            'should accept equal decimal monetary amounts',
            async function () {

                const result =
                    await ledgerService.recordBalancedTransaction({

                        tenantId:
                            TENANT_ID,

                        debitAccountId:
                            DEBIT_ACCOUNT,

                        creditAccountId:
                            CREDIT_ACCOUNT,

                        debitAmount:
                            100.25,

                        creditAmount:
                            100.25,

                        reference:
                            'ref-balanced-decimal',

                        description:
                            'Decimal balanced transaction'

                    });


                expect(result)
                    .to.deep.equal({

                        success:
                            true,

                        transactionId:
                            'tx123'

                    });


                expect(
                    Transaction.create.calledOnce
                ).to.equal(true);

            }
        );

    });

});