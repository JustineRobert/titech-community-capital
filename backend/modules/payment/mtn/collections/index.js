'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Collections Module
 * =============================================================================
 *
 * Enterprise Composition Root
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Central dependency composition layer for MTN MoMo Collection processing.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Initialize collection services
 * • Wire collection dependencies
 * • Expose collection workflow components
 * • Validate required infrastructure
 * • Provide a consistent module boundary
 *
 * Processing Pipeline
 * -----------------------------------------------------------------------------
 *
 * Collection Request
 *        │
 *        ▼
 * TransactionBuilder
 *        │
 *        ▼
 * CollectionService
 *        │
 *        ├────────► MTN API Client
 *        │
 *        ├────────► TransactionStateMachine
 *        │
 *        ├────────► LedgerBridge
 *        │
 *        ├────────► Callback Processing
 *        │
 *        └────────► Audit / Metrics / Events
 *
 * =============================================================================
 */


const TransactionBuilder =
    require('./transactionBuilder');


const TransactionStateMachine =
    require('./transactionStateMachine');


const LedgerBridge =
    require('./ledgerBridge');


/**
 * =============================================================================
 * Dependency Validation
 * =============================================================================
 */

function validateDependencies(dependencies = {}) {

    const required = [

        'repository',

        'ledgerEngine'

    ];


    const missing = required.filter(

        dependency =>

            dependencies[dependency] === undefined ||

            dependencies[dependency] === null

    );


    if (missing.length) {

        throw new Error(

            `MTN Collections module missing dependencies: ${missing.join(', ')}`

        );

    }

}


/**
 * =============================================================================
 * Collection Module Factory
 * =============================================================================
 */

function createCollectionsModule({

    repository,

    ledgerEngine,

    configuration,

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
     * Ledger Bridge
     * -------------------------------------------------------------------------
     */

    const ledgerBridge =

        new LedgerBridge({

            ledgerEngine,

            auditService,

            metrics,

            eventBus,

            logger:
                moduleLogger

        });



    moduleLogger.info?.({

        event:
            'payment.mtn.collections.initialized',

        provider:
            'MTN'

    });



    return {

        /**
         * Payload Construction
         */

        transactionBuilder,


        /**
         * Transaction Lifecycle
         */

        transactionStateMachine,


        /**
         * Financial Integration
         */

        ledgerBridge

    };

}


/**
 * =============================================================================
 * Public Module API
 * =============================================================================
 */

module.exports = {

    createCollectionsModule,


    TransactionBuilder,

    TransactionStateMachine,

    LedgerBridge

};