'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Module
 * =============================================================================
 *
 * Enterprise Composition Root
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Central dependency composition layer for MTN MoMo disbursement workflows.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Initialize disbursement services
 * • Wire transaction lifecycle components
 * • Provide a controlled module boundary
 * • Validate required infrastructure
 * • Expose reusable disbursement capabilities
 *
 * Processing Pipeline
 * -----------------------------------------------------------------------------
 *
 * Disbursement Request
 *          |
 *          ▼
 * TransactionBuilder
 *          |
 *          ▼
 * FraudGuard
 *          |
 *          ▼
 * TransactionStateMachine
 *          |
 *          ▼
 * MTN Disbursement Provider
 *          |
 *          ▼
 * Callback Processing
 *          |
 *          ▼
 * SettlementTracker
 *          |
 *          ▼
 * LedgerBridge
 *          |
 *          ▼
 * Financial Core Ledger
 *
 * =============================================================================
 */


const TransactionBuilder =
    require('./transactionBuilder');


const TransactionStateMachine =
    require('./transactionStateMachine');


const SettlementTracker =
    require('./settlementTracker');


const LedgerBridge =
    require('./ledgerBridge');




/**
 * =============================================================================
 * Dependency Validation
 * =============================================================================
 */


function validateDependencies({

    repository,

    ledgerEngine

} = {}) {


    const missing = [];


    if (!repository) {

        missing.push(

            'repository'

        );

    }


    if (!ledgerEngine) {

        missing.push(

            'ledgerEngine'

        );

    }



    if (missing.length) {


        throw new Error(

            `MTN Disbursement module missing dependencies: ${missing.join(', ')}`

        );


    }


}





/**
 * =============================================================================
 * Create MTN Disbursement Module
 * =============================================================================
 */


function createDisbursementModule({

    repository,

    ledgerEngine,

    configuration,

    fraudGuard,

    eventBus,

    auditService,

    metrics,

    logger,

    stateMachine

} = {}) {



    validateDependencies({

        repository,

        ledgerEngine

    });




    const moduleLogger =

        logger || console;





    /**
     * -------------------------------------------------------------------------
     * Transaction Builder
     * -------------------------------------------------------------------------
     */


    const transactionBuilder =

        new TransactionBuilder({

            configuration,

            logger:

                moduleLogger

        });







    /**
     * -------------------------------------------------------------------------
     * Transaction State Machine
     * -------------------------------------------------------------------------
     */


    const transactionStateMachine =

        stateMachine ||

        new TransactionStateMachine({

            repository,

            eventBus,

            auditService,

            metrics,

            logger:

                moduleLogger

        });







    /**
     * -------------------------------------------------------------------------
     * Settlement Tracker
     * -------------------------------------------------------------------------
     */


    const settlementTracker =

        new SettlementTracker({

            repository,

            auditService,

            eventBus,

            metrics,

            logger:

                moduleLogger

        });








    /**
     * -------------------------------------------------------------------------
     * Ledger Bridge
     * -------------------------------------------------------------------------
     */


    const ledgerBridge =

        new LedgerBridge({

            ledgerEngine,

            auditService,

            eventBus,

            metrics,

            logger:

                moduleLogger

        });







    moduleLogger.info?.({

        event:

            'payment.mtn.disbursement.module.initialized',

        provider:

            'MTN'

    });







    return {


        /**
         * Payload generation
         */

        transactionBuilder,



        /**
         * Lifecycle management
         */

        transactionStateMachine,



        /**
         * Settlement operations
         */

        settlementTracker,



        /**
         * Accounting integration
         */

        ledgerBridge,



        /**
         * Optional risk controls
         */

        fraudGuard:


            fraudGuard || null


    };


}







/**
 * =============================================================================
 * Public API
 * =============================================================================
 */


module.exports = {


    createDisbursementModule,


    TransactionBuilder,


    TransactionStateMachine,


    SettlementTracker,


    LedgerBridge


};