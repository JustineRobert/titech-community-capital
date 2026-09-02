/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementRepairService.js
 * ============================================================================
 *
 * Enterprise Statement Repair Service
 *
 * Part 1 — Enterprise Foundation
 *
 * Responsibilities:
 *
 *  - Convert reconciliation exceptions into controlled repair actions.
 *  - Create immutable repair instructions.
 *  - Protect ledger integrity.
 *  - Provide idempotent repair execution identity.
 *  - Preserve investigation evidence.
 *  - Enforce tenant isolation.
 *  - Prepare repairs for approval workflows.
 *
 *
 * Repair Lifecycle:
 *
 * CREATED
 *    |
 *    v
 * VALIDATED
 *    |
 *    v
 * APPROVED
 *    |
 *    v
 * EXECUTING
 *    |
 *    +------------+
 *    |            |
 *    v            v
 * EXECUTED     FAILED
 *
 *
 * Principles:
 *
 *  - No direct ledger mutation.
 *  - Ledger writes happen through LedgerService.
 *  - Every repair is traceable.
 *  - Repairs are idempotent.
 *  - Closed periods protected.
 *  - Tenant isolated.
 *
 * ============================================================================
 */

'use strict';


const crypto = require('crypto');


const {
    StatementProcessingError
} = require('./StatementErrors');



const {
    createRepairForecastEngine
} = require(
    './forecasting/RepairForecastEngine'
);

const repairForecastEngine =
    createRepairForecastEngine({
        dataProvider: repairRepository,
        logger,
        metrics
    });

const forecast =
    await repairForecastEngine.forecast({
        tenantId,
        horizonDays: 30,
        historicalDays: 180,
        dailyCapacityMinutes: 480
    });


const forecast =
    await repairForecastEngine.forecastFromHistory({
        tenantId,
        history: repairHistory,
        horizonDays: 30
    });



/**
 * ============================================================================
 * Repair Lifecycle States
 * ============================================================================
 */

const REPAIR_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    VALIDATED:
        'VALIDATED',

    APPROVED:
        'APPROVED',

    EXECUTING:
        'EXECUTING',

    EXECUTED:
        'EXECUTED',

    FAILED:
        'FAILED',

    RETRYING:
        'RETRYING',

    REJECTED:
        'REJECTED'

});



/**
 * ============================================================================
 * Workflow Transition Map
 * ============================================================================
 */

const REPAIR_TRANSITIONS = Object.freeze({

    CREATED: [

        REPAIR_STATUS.VALIDATED,

        REPAIR_STATUS.REJECTED

    ],


    VALIDATED: [

        REPAIR_STATUS.APPROVED,

        REPAIR_STATUS.REJECTED

    ],


    APPROVED: [

        REPAIR_STATUS.EXECUTING,

        REPAIR_STATUS.REJECTED

    ],


    EXECUTING: [

        REPAIR_STATUS.EXECUTED,

        REPAIR_STATUS.FAILED

    ],


    FAILED: [

        'RETRYING'

    ],


    RETRYING: [

        REPAIR_STATUS.EXECUTING

    ],


    EXECUTED: [],


    REJECTED: []

});




/**
 * ============================================================================
 * Repair Classification
 * ============================================================================
 */

const REPAIR_TYPE = Object.freeze({

    MISSING_LEDGER_ENTRY:
        'MISSING_LEDGER_ENTRY',


    AMOUNT_ADJUSTMENT:
        'AMOUNT_ADJUSTMENT',


    UNMATCHED_TRANSACTION:
        'UNMATCHED_TRANSACTION',


    DUPLICATE_LEDGER_ENTRY:
        'DUPLICATE_LEDGER_ENTRY',


    INCORRECT_ACCOUNT_MAPPING:
        'INCORRECT_ACCOUNT_MAPPING',


    FAILED_SETTLEMENT_POSTING:
        'FAILED_SETTLEMENT_POSTING',


    MISSING_SETTLEMENT:
        'MISSING_SETTLEMENT',


    CURRENCY_VARIANCE:
        'CURRENCY_VARIANCE',


    DATE_POSTING_ERROR:
        'DATE_POSTING_ERROR',


    INTEREST_ACCRUAL_VARIANCE:
        'INTEREST_ACCRUAL_VARIANCE',


    LOAN_REPAYMENT_VARIANCE:
        'LOAN_REPAYMENT_VARIANCE'

});





/**
 * ============================================================================
 * Severity Classification
 * ============================================================================
 */

const REPAIR_SEVERITY = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});









/**
 * ============================================================================
 * StatementRepairService
 * ============================================================================
 */

class StatementRepairService {


    constructor({

        ledgerService = null,

        auditService = null,

        repairRepository = null,

        transactionManager = null


    } = {}) {


        this.ledgerService =
            ledgerService;


        this.auditService =
            auditService;


        this.repairRepository =
            repairRepository;


        this.transactionManager =
            transactionManager;


    }

    /**
 * ============================================================================
 * Approve Repair
 * ============================================================================
 */

    async approveRepair(

        repair,

        approver,

        context

    ) {


        this.validateAuthority(

            approver,

            context

        );


        return this.transitionRepair(

            repair,

            REPAIR_STATUS.APPROVED,

            {

                approvedBy:

                    approver.id,


                approvedAt:

                    new Date()

            }

        );


    }


    /**
 * ============================================================================
 * Reject Repair
 * ============================================================================
 */

async rejectRepair(

    repair,

    reason,

    authority,

    context

){


    this.validateAuthority(

        authority,

        context

    );


    return this.transitionRepair(

        repair,

        REPAIR_STATUS.REJECTED,

        {

            rejectionReason:

                reason,


            rejectedBy:

                authority.id,


            rejectedAt:

                new Date()

        }

    );


}


/**
 * ============================================================================
 * Fail Repair
 * ============================================================================
 */

async failRepair(

    repair,

    error

){


    return this.transitionRepair(

        repair,

        REPAIR_STATUS.FAILED,

        {

            failure:

            {

                message:

                    error.message,


                timestamp:

                    new Date()

            }

        }

    );


}

/**
 * ============================================================================
 * Retry Repair
 * ============================================================================
 */

async retryRepair(

    repair,

    context

){


    if(
        repair.status !== REPAIR_STATUS.FAILED
    ){

        throw new StatementProcessingError(

            'Only failed repairs can retry'

        );

    }



    return this.transitionRepair(

        repair,

        REPAIR_STATUS.RETRYING,

        {

            retryRequestedAt:

                new Date(),


            tenantId:

                context.tenantId

        }

    );


}

/**
 * ============================================================================
 * Recover Repair
 * ============================================================================
 */

async recoverRepair(

    repair,

    context

){


    const retry =

        await this.retryRepair(

            repair,

            context

        );



    return this.transitionRepair(

        retry,

        REPAIR_STATUS.EXECUTING,

        {

            recoveredAt:

                new Date()

        }

    );


}

/**
 * ============================================================================
 * Repair State Transition Engine
 * ============================================================================
 */

async transitionRepair(

    repair,

    nextStatus,

    metadata = {}

){


    if(!repair){

        throw new StatementProcessingError(

            'Repair required'

        );

    }



    const allowed =

        REPAIR_TRANSITIONS[

            repair.status

        ] || [];




    if(
        !allowed.includes(nextStatus)
    ){


        throw new StatementProcessingError(

            `Invalid repair transition ${repair.status} -> ${nextStatus}`

        );


    }






    const updatedRepair = Object.freeze({

        ...repair,


        status:

            nextStatus,


        workflow:

        {

            ...(repair.workflow || {}),

            ...metadata

        },


        updatedAt:

            new Date()

    });







    await this.persistTransition(

        updatedRepair

    );



    await this.audit(

        'STATEMENT_REPAIR_STATUS_CHANGED',

        {

            repairId:

                repair.repairId,


            previousStatus:

                repair.status,


            nextStatus,


            metadata

        }

    );




    return updatedRepair;


}

/**
 * ============================================================================
 * Persist Workflow Transition
 * ============================================================================
 */

async persistTransition(

    repair

){


    if(
        this.repairRepository &&
        this.repairRepository.update
    ){

        return this.repairRepository.update(

            repair.repairId,

            repair

        );

    }



    return repair;


}

/**
 * ============================================================================
 * Approval Authority Validation
 * ============================================================================
 */

validateAuthority(

    authority,

    context

){


    if(!authority){

        throw new StatementProcessingError(

            'Approval authority required'

        );

    }




    if(
        authority.tenantId !== context.tenantId
    ){

        throw new StatementProcessingError(

            'Authority tenant mismatch'

        );

    }




    const allowedRoles = [

        'FINANCE_MANAGER',

        'ACCOUNTANT',

        'SYSTEM_ADMIN'

    ];




    if(
        !allowedRoles.includes(
            authority.role
        )
    ){

        throw new StatementProcessingError(

            'Insufficient approval authority'

        );

    }


}

/**
 * ============================================================================
 * Ledger Repair Constants
 * ============================================================================
 */

const LEDGER_REPAIR_ACTION = Object.freeze({

    ADJUSTMENT:
        'ADJUSTMENT',

    REVERSAL:
        'REVERSAL'

});



const JOURNAL_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    POSTED:
        'POSTED',

    REVERSED:
        'REVERSED'

});



    /**
     * =========================================================================
     * Create Repair Plan
     * =========================================================================
     */

    async createRepairPlan(

        reconciliation,

        context

    ) {


        try {


            this.validateInput(

                reconciliation,

                context

            );



            const repairs = [];





            for (
                const transaction of
                reconciliation.unmatched || []
            ) {


                repairs.push(

                    this.createRepair(

                        REPAIR_TYPE.UNMATCHED_TRANSACTION,

                        transaction,

                        context

                    )

                );

            }


            for (
                const variance of
                reconciliation.variances || []
            ) {


                repairs.push(

                    this.createRepair(

                        REPAIR_TYPE.AMOUNT_ADJUSTMENT,

                        variance,

                        context

                    )

                );

            }


            const plan = Object.freeze({

                repairPlanId:

                    this.generateRepairPlanId(
                        reconciliation
                    ),


                tenantId:

                    context.tenantId,


                statementId:

                    reconciliation.statementId,


                batchId:

                    reconciliation.batchId,


                repairs,


                repairCount:

                    repairs.length,


                status:

                    REPAIR_STATUS.CREATED,


                createdAt:

                    new Date()

            });






            await this.persist(plan);


            await this.audit(

                'STATEMENT_REPAIR_PLAN_CREATED',

                plan

            );



            return plan;


        }


        catch (error) {


            if (
                error instanceof StatementProcessingError
            ) {

                throw error;

            }



            throw new StatementProcessingError(

                'Repair plan creation failed',

                {
                    error:
                        error.message
                }

            );


        }


    }


    /**
     * =========================================================================
     * Create Repair Object
     * =========================================================================
     */

    createRepair(

        type,

        evidence,

        context

    ) {


        const repairId =
            crypto.randomUUID();



        return Object.freeze({

            repairId,


            tenantId:

                context.tenantId,


            type,


            severity:

                this.calculateSeverity(type),



            executionId:

                this.generateExecutionId(

                    repairId,

                    context.tenantId

                ),



            status:

                REPAIR_STATUS.CREATED,



            metadata: {

                source:

                    'StatementReconciliationService',


                createdAt:

                    new Date()

            },



            evidence,



            createdAt:

                new Date()


        });


    }

    /**
     * =========================================================================
     * Validate Repair
     * =========================================================================
     */

    async validateRepair(

        repair,

        context

    ) {


        if (!repair) {

            throw new StatementProcessingError(

                'Repair required'

            );

        }





        if (
            repair.tenantId !== context.tenantId
        ) {

            throw new StatementProcessingError(

                'Tenant mismatch'

            );

        }





        return Object.freeze({

            ...repair,


            status:

                REPAIR_STATUS.VALIDATED,


            validatedAt:

                new Date()

        });


    }

    /**
 * ============================================================================
 * Execute Approved Repair
 * ============================================================================
 *
 * Flow:
 *
 * Approved Repair
 *       |
 *       v
 * Validate
 *       |
 *       v
 * Create Adjustment Instruction
 *       |
 *       v
 * LedgerService
 *       |
 *       v
 * Audit
 *
 */

async executeRepair(

    repair,

    context

){


    this.validateTenant(

        repair,

        context

    );




    if(
        repair.status !== REPAIR_STATUS.APPROVED
    ){

        throw new StatementProcessingError(

            'Only approved repairs may execute'

        );

    }


    validateTenant(

    repair,

    context

){


    if(
        repair.tenantId !== context.tenantId
    ){

        throw new StatementProcessingError(

            'Tenant isolation violation'

        );

    }


}




    return this.executeWithinTransaction(

        async()=>{


            const instruction =

                await this.createLedgerAdjustment(

                    repair,

                    context

                );




            const result =

                await this.postLedgerAdjustment(

                    instruction,

                    context

                );





            const completed = Object.freeze({

                ...repair,


                status:

                    REPAIR_STATUS.EXECUTED,


                ledgerReference:

                    result.reference,


                executedAt:

                    new Date()

            });





            await this.persistTransition(

                completed

            );




            await this.audit(

                'STATEMENT_REPAIR_EXECUTED',

                completed

            );





            return completed;


        }

    );


}


/**
 * ============================================================================
 * Create Ledger Adjustment Instruction
 * ============================================================================
 */

async createLedgerAdjustment(

    repair,

    context

){


    const journalId =

        this.generateJournalId(

            repair

        );




    const instruction = Object.freeze({

        journalId,


        repairId:

            repair.repairId,


        tenantId:

            context.tenantId,


        action:

            LEDGER_REPAIR_ACTION.ADJUSTMENT,



        entries:

            this.generateJournalEntries(

                repair

            ),



        status:

            JOURNAL_STATUS.CREATED,



        createdAt:

            new Date()

    });





    this.validateJournalBalance(

        instruction.entries

    );





    return instruction;


}

/**
 * ============================================================================
 * Generate Journal Entries
 * ============================================================================
 */

generateJournalEntries(

    repair

){


    const evidence =
        repair.evidence || {};




    const amount =

        Number(

            evidence.amount ||

            evidence.transactionAmount ||

            0

        );





    if(amount <= 0){

        throw new StatementProcessingError(

            'Repair amount invalid'

        );

    }






    return [

        {

            account:

                evidence.debitAccount,


            debit:

                amount,


            credit:

                0,


            description:

                `Repair ${repair.repairId}`

        },


        {

            account:

                evidence.creditAccount,


            debit:

                0,


            credit:

                amount,


            description:

                `Repair ${repair.repairId}`

        }

    ];


}

/**
 * ============================================================================
 * Validate Journal Balance
 * ============================================================================
 */

validateJournalBalance(

    entries

){


    const debit =

        entries.reduce(

            (sum,e)=>

                sum + Number(e.debit || 0),

            0

        );




    const credit =

        entries.reduce(

            (sum,e)=>

                sum + Number(e.credit || 0),

            0

        );





    if(
        debit !== credit
    ){

        throw new StatementProcessingError(

            'Ledger adjustment is not balanced'

        );

    }



    return true;


}

/**
 * ============================================================================
 * Post Ledger Adjustment
 * ============================================================================
 */

async postLedgerAdjustment(

    instruction,

    context

){


    if(
        !this.ledgerService
    ){

        throw new StatementProcessingError(

            'Ledger service unavailable'

        );

    }





    return this.ledgerService.createJournal({

        tenantId:

            context.tenantId,


        journalId:

            instruction.journalId,


        entries:

            instruction.entries,


        reference:

            instruction.repairId,


        source:

            'STATEMENT_REPAIR'

    });


}


/**
 * ============================================================================
 * Validate Financial Period
 * ============================================================================
 */

async validateFinancialPeriod(

    repair

){


    if(
        !this.ledgerService ||
        !this.ledgerService.isPeriodClosed
    ){

        return true;

    }





    const closed =

        await this.ledgerService.isPeriodClosed(

            repair.evidence.transactionDate

        );





    if(closed){

        throw new StatementProcessingError(

            'Cannot repair closed financial period'

        );

    }



    return true;


}

/**
 * ============================================================================
 * Transaction Boundary
 * ============================================================================
 */

async executeWithinTransaction(

    callback

){


    if(
        this.transactionManager
    ){

        return this.transactionManager.execute(

            callback

        );

    }



    return callback();


}

/**
 * ============================================================================
 * Create Reversal Instruction
 * ============================================================================
 */

async createReversal(

    executedRepair,

    context

){


    if(
        executedRepair.status !==
        REPAIR_STATUS.EXECUTED
    ){

        throw new StatementProcessingError(

            'Only executed repairs can reverse'

        );

    }





    const reversal = Object.freeze({

        reversalId:

            crypto.randomUUID(),


        originalRepairId:

            executedRepair.repairId,


        tenantId:

            context.tenantId,


        action:

            LEDGER_REPAIR_ACTION.REVERSAL,


        journalReference:

            executedRepair.ledgerReference,


        createdAt:

            new Date()

    });






    await this.audit(

        'STATEMENT_REPAIR_REVERSAL_CREATED',

        reversal

    );





    return reversal;


}



    /**
     * =========================================================================
     * Idempotency Identity
     * =========================================================================
     */

    generateExecutionId(

        repairId,

        tenantId

    ) {


        return crypto

            .createHash('sha256')

            .update(

                `${tenantId}:${repairId}`

            )

            .digest('hex');


    }



    /**
     * =========================================================================
     * Repair Plan Identity
     * =========================================================================
     */

    generateRepairPlanId(

        reconciliation

    ) {


        return (

            'REPAIR-' +

            crypto

                .createHash('sha256')

                .update(

                    reconciliation.statementId

                )

                .digest('hex')

                .substring(0, 20)

        );


    }



    /**
 * =========================================================================
 * Severity Rules
 * =========================================================================
 */

    calculateSeverity(type) {

        if (!type) {
            return REPAIR_SEVERITY.MEDIUM;
        }

        switch (type) {

            case REPAIR_TYPE.DUPLICATE_LEDGER_ENTRY:
                return REPAIR_SEVERITY.CRITICAL;


            case REPAIR_TYPE.MISSING_LEDGER_ENTRY:
            case REPAIR_TYPE.FAILED_SETTLEMENT_POSTING:
            case REPAIR_TYPE.LOAN_REPAYMENT_VARIANCE:
                return REPAIR_SEVERITY.HIGH;


            default:
                return REPAIR_SEVERITY.MEDIUM;
        }
    }

    /**
     * =========================================================================
     * Repository Persistence
     * =========================================================================
     */

    async persist(data) {


        if (
            this.repairRepository
        ) {

            return this.repairRepository.save(data);

        }


        return data;


    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async audit(

    action,

    data

){


    if(
        this.auditService
    ){

        return this.auditService.log({

            eventId:

                crypto.randomUUID(),


            action,


            entity:

                'STATEMENT_REPAIR',


            immutable:

                true,


            timestamp:

                new Date(),


            data

        });

    }


}

/**
 * ============================================================================
 * Generate Journal ID
 * ============================================================================
 */

generateJournalId(

    repair

){


    return (

        'ADJ-' +

        crypto

            .createHash('sha256')

            .update(

                repair.repairId

            )

            .digest('hex')

            .substring(0,24)

    );


}


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateInput(

        reconciliation,

        context

    ) {


        if (!reconciliation) {

            throw new StatementProcessingError(

                'Reconciliation result required'

            );

        }



        if (
            !context ||
            !context.tenantId
        ) {

            throw new StatementProcessingError(

                'Tenant context required'

            );

        }


    }


}

module.exports =
    StatementRepairService;



module.exports.REPAIR_STATUS =
    REPAIR_STATUS;



module.exports.REPAIR_TYPE =
    REPAIR_TYPE;



module.exports.REPAIR_SEVERITY =
    REPAIR_SEVERITY;

module.exports.LEDGER_REPAIR_ACTION =
    LEDGER_REPAIR_ACTION;


module.exports.JOURNAL_STATUS =
    JOURNAL_STATUS;