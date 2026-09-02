'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Processor
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise callback processing engine responsible for consuming validated
 * Airtel Money callback events and coordinating internal payment lifecycle
 * updates.
 *
 * Responsibilities
 * ----------------
 * • Callback lifecycle orchestration
 * • Correlation result consumption
 * • Idempotent callback processing
 * • Payment state transitions
 * • Transaction status updates
 * • Ledger integration hooks
 * • Reconciliation triggers
 * • Settlement confirmation hooks
 * • Notification events
 * • Audit trail completion
 * • Failure recovery
 * • Dead-letter routing
 * • Metrics
 * • Distributed tracing
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • HTTP callback reception
 * • Signature verification
 * • OAuth authentication
 * • Provider communication
 * • Ledger implementation
 *
 * Processing Pipeline
 * -------------------
 *
 * Airtel Callback
 *        |
 *        v
 * Validator
 *        |
 *        v
 * Correlation Engine
 *        |
 *        v
 * Callback Processor
 *        |
 *        +--> Payment State
 *        |
 *        +--> Ledger
 *        |
 *        +--> Reconciliation
 *        |
 *        +--> Settlement
 *        |
 *        +--> Notifications
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError,
    ValidationError
} = require('../../../shared/errors');


/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PROVIDER = Object.freeze({

    NAME: 'AIRTEL',

    MODULE: 'callback-processor'

});


const CALLBACK_STATUS = Object.freeze({

    RECEIVED: 'RECEIVED',

    PROCESSING: 'PROCESSING',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    DUPLICATE: 'DUPLICATE',

    DEAD_LETTER: 'DEAD_LETTER'

});


const PAYMENT_STATUS = Object.freeze({

    SUCCESS: 'SUCCESS',

    FAILED: 'FAILED',

    PENDING: 'PENDING'

});


/**
 * =============================================================================
 * Callback Processor
 * =============================================================================
 */

class CallbackProcessor {


    constructor({

        paymentRepository,

        transactionService,

        ledgerBridge,

        ledgerService,

        paymentStateEngine,

        reconciliationService,

        settlementService,

        notificationService,

        callbackRepository,

        idempotencyManager,

        deadLetterQueue,

        recoveryService,

        auditService,

        eventBus,

        metrics,

        tracer,

        logger

    } = {}) {

        this.paymentRepository =
            paymentRepository;


        this.transactionService =
            transactionService;


        this.ledgerBridge =
            ledgerBridge;


        this.ledgerService =
            ledgerService;


        this.paymentStateEngine =
            paymentStateEngine;

        this.reconciliationService =
            reconciliationService;


        this.settlementService =
            settlementService;


        this.notificationService =
            notificationService;


        this.callbackRepository =
            callbackRepository;


        this.idempotencyManager =
            idempotencyManager;


        this.deadLetterQueue =
            deadLetterQueue;


        this.recoveryService =
            recoveryService;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.logger =
            logger;



        this.statistics = {


            received:
                0,


            processed:
                0,


            failed:
                0,


            duplicates:
                0,


            ledgerUpdates:
                0,


            reconciliations:
                0,


            settlements:
                0


        };


        this.startedAt =
            new Date();


    }



    /**
     * =========================================================================
     * Process Callback
     * =========================================================================
     */


    async process({

        tenantId,

        callback,

        correlation,

        correlationId = crypto.randomUUID()

    }) {


        const span =
            this.tracer?.startSpan?.(

                'airtel.callback.process'

            );


        try {


            this.statistics.received++;


            this.validateInput({

                callback,

                correlation

            });



            const duplicate =

                await this.checkDuplicate({

                    tenantId,

                    callback

                });



            if (duplicate) {


                this.statistics.duplicates++;


                return {


                    status:

                        CALLBACK_STATUS.DUPLICATE,


                    correlationId


                };


            }



            await this.markProcessing({

                tenantId,

                callback,

                correlationId

            });



            const payment =

                correlation.payment;



            const updated =

                await this.updatePaymentStatus({

                    tenantId,

                    payment,

                    callback,

                    correlationId

                });



            await this.processFinancialEffects({

                tenantId,

                payment: updated,

                callback,

                correlationId

            });



            await this.completeProcessing({

                tenantId,

                callback,

                correlationId

            });



            this.statistics.processed++;



            return {


                status:

                    CALLBACK_STATUS.COMPLETED,


                paymentId:

                    updated.id,


                correlationId


            };


        }

        catch (error) {


            this.statistics.failed++;


            await this.handleFailure({

                tenantId,

                callback,

                correlationId,

                error

            });


            throw normalizeError(error);


        }


        finally {


            span?.end?.();


        }


    }



    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */


    validateInput({

        callback,

        correlation

    }) {


        if (!callback) {


            throw new ValidationError(

                'Callback payload missing'

            );

        }


        if (!correlation?.payment) {


            throw new ValidationError(

                'Callback payment correlation missing'

            );

        }


    }



    /**
     * =========================================================================
     * Duplicate Protection
     * =========================================================================
     */


    async checkDuplicate({

        tenantId,

        callback

    }) {


        const key =

            `airtel:processed:${tenantId}:${callback.transactionId

            }`;



        return await this.idempotencyManager

            ?.check?.({

                key

            });


    }



    /**
     * =========================================================================
     * Payment State Update
     * =========================================================================
     */


    async updatePaymentStatus({

        tenantId,

        payment,

        callback,

        correlationId

    }) {


        const status =

            callback.status === 'SUCCESS'

                ? PAYMENT_STATUS.SUCCESS

                : PAYMENT_STATUS.FAILED;



        return await this.paymentRepository.updateStatus({

            tenantId,

            paymentId:

                payment.id,

            status,

            providerReference:

                callback.transactionId,

            correlationId

        });


    }



    /**
     * =========================================================================
     * Financial Processing
     * =========================================================================
     */


    async processFinancialEffects({

        tenantId,

        payment,

        callback,

        correlationId

    }) {


        if (

            payment.status === PAYMENT_STATUS.SUCCESS

        ) {


            await this.postLedger({

                tenantId,

                payment,

                callback,

                correlationId

            });



            await this.triggerReconciliation({

                tenantId,

                payment,

                correlationId

            });



            await this.confirmSettlement({

                tenantId,

                payment,

                correlationId

            });



        }



        await this.publishEvents({

            tenantId,

            payment,

            correlationId

        });


    }



    /**
     * =========================================================================
     * Ledger
     * =========================================================================
     */


    async postLedger({

        tenantId,

        payment,

        correlationId

    }) {


        if (!this.ledgerBridge) {


            return;


        }


        await this.ledgerBridge.postCollection({

            tenantId,

            transactionId:

                payment.id,

            amount:

                payment.amount,

            currency:

                payment.currency,

            provider:

                PROVIDER.NAME,

            correlationId

        });


        this.statistics.ledgerUpdates++;


    }



    /**
     * =========================================================================
     * Reconciliation
     * =========================================================================
     */


    async triggerReconciliation({

        tenantId,

        payment,

        correlationId

    }) {


        await this.reconciliationService

            ?.enqueue?.({

                tenantId,

                provider:

                    PROVIDER.NAME,

                transactionId:

                    payment.id,

                correlationId

            });


        this.statistics.reconciliations++;


    }



    /**
     * =========================================================================
     * Settlement Confirmation
     * =========================================================================
     */


    async confirmSettlement({

        tenantId,

        payment,

        correlationId

    }) {


        await this.settlementService

            ?.confirmCollection?.({

                tenantId,

                provider:

                    PROVIDER.NAME,

                transactionId:

                    payment.id,

                correlationId

            });


        this.statistics.settlements++;


    }



    /**
     * =========================================================================
     * Event Publishing
     * =========================================================================
     */


    async publishEvents({

        tenantId,

        payment,

        correlationId

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_PAYMENT_CALLBACK_PROCESSED',

            tenantId,

            correlationId,

            payload:

                payment

        });


    }



    /**
     * =========================================================================
     * Processing State
     * =========================================================================
     */


    async markProcessing({

        tenantId,

        callback,

        correlationId

    }) {


        await this.callbackRepository?.updateStatus?.({

            tenantId,

            callbackId:

                callback.id,

            status:

                CALLBACK_STATUS.PROCESSING,

            correlationId

        });


    }



    async completeProcessing({

        tenantId,

        callback,

        correlationId

    }) {


        await this.callbackRepository?.updateStatus?.({

            tenantId,

            callbackId:

                callback.id,

            status:

                CALLBACK_STATUS.COMPLETED,

            correlationId

        });



        await this.auditService?.record?.({

            action:

                'AIRTEL_CALLBACK_COMPLETED',

            tenantId,

            correlationId

        });


    }



    /**
     * =========================================================================
     * Failure Handling
     * =========================================================================
     */


    async handleFailure({

        tenantId,

        callback,

        correlationId,

        error

    }) {


        this.logger?.error?.({

            message:

                'Airtel callback processing failed',

            tenantId,

            correlationId,

            error:

                error.message

        });



        await this.deadLetterQueue?.publish?.({

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId,

            callback,

            error:

                error.message

        });



        await this.recoveryService?.schedule?.({

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId

        });


    }



    /**
     * =========================================================================
     * Health
     * =========================================================================
     */


    health() {


        return {


            provider:

                PROVIDER.NAME,


            status:

                'UP',


            statistics:

                this.statistics,


            uptimeMs:

                Date.now() -

                this.startedAt.getTime()


        };


    }

    /**
 * =========================================================================
 * Part 3.1 — Callback Processing Integration Foundation
 * =========================================================================
 *
 * Enterprise callback processing orchestration.
 *
 * Responsibilities:
 *
 * - Consume validated Airtel callbacks
 * - Execute correlation intelligence
 * - Update payment lifecycle
 * - Post financial transactions
 * - Trigger reconciliation
 * - Publish events
 * - Handle failures safely
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Process Callback Entry Point
     * -------------------------------------------------------------------------
     */

    async processCallback({

        callback,

        context

    }) {


        const span =

            this.tracer?.startSpan?.(

                'airtel.callback.processing'

            );



        const startedAt = Date.now();



        try {


            this.validateProcessingRequest({

                callback,

                context

            });





            const lifecycle =

                await this.createCallbackLifecycle({

                    callback,

                    context

                });





            /**
             * Step 1
             * Correlation intelligence
             */

            const correlation =

                await this.callbackCorrelation.executeCorrelationLookup({

                    callback,

                    context

                });






            /**
             * Step 2
             * Intelligence decision
             */

            const intelligence =

                await this.callbackCorrelation.executeCorrelationIntelligence({

                    callback,

                    context,

                    correlationResult:

                        correlation

                });






            correlation.intelligence =

                intelligence;








            /**
             * Step 3
             * Route decision
             */

            const route =

                this.callbackCorrelation.determineCallbackRoute({

                    ...correlation,

                    fraudSignals:

                        intelligence.signals

                });








            switch (route) {


                case 'PROCESS_PAYMENT':


                    return await this.processSuccessfulCallback({

                        callback,

                        context,

                        correlation

                    });




                case 'MANUAL_REVIEW':


                    return await this.routeManualReview({

                        callback,

                        context,

                        correlation

                    });





                case 'FRAUD_REVIEW':


                    return await this.routeFraudReview({

                        callback,

                        context,

                        correlation

                    });





                default:


                    return await this.handleUnknownCallback({

                        callback,

                        context,

                        correlation

                    });


            }



        }

        catch (error) {


            await this.handleProcessingFailure({

                callback,

                context,

                error

            });


            throw error;


        }

        finally {


            this.metrics?.histogram?.(

                'airtel_callback_processing_duration_ms',

                Date.now() - startedAt

            );


            span?.end?.();


        }


    }

    /**
 * -------------------------------------------------------------------------
 * Successful Callback Processing
 * -------------------------------------------------------------------------
 */

    async processSuccessfulCallback({

        callback,

        context,

        correlation

    }) {


        const payment =

            correlation.entity;





        /**
         * Payment state transition
         */

        const updatedPayment =

            await this.paymentStateEngine.transition({

                paymentId:

                    payment.id,


                event:

                    'PROVIDER_CONFIRMED',



                metadata: {


                    provider:

                        'AIRTEL',


                    callbackReference:

                        callback.reference,


                    correlationId:

                        context.correlationId


                }


            });







        /**
         * Financial posting
         */

        await this.postLedgerTransaction({

            callback,

            context,

            payment:

                updatedPayment

        });







        /**
         * Settlement reconciliation hook
         */

        await this.triggerSettlementReconciliation({

            callback,

            context,

            payment:

                updatedPayment

        });








        /**
         * Publish lifecycle event
         */

        await this.publishPaymentEvent({

            type:

                'AIRTEL_PAYMENT_COMPLETED',


            context,

            payment:

                updatedPayment

        });







        return {


            status:

                'COMPLETED',


            payment:

                updatedPayment,


            correlationId:

                context.correlationId


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Ledger Posting
     * -------------------------------------------------------------------------
     */

    async postLedgerTransaction({

        callback,

        context,

        payment

    }) {


        if (

            !this.ledgerService

        ) {


            this.logger?.warn?.({

                message:

                    'Ledger service unavailable',


                correlationId:

                    context.correlationId

            });


            return null;

        }






        return this.ledgerService.post({

            transactionType:

                'AIRTEL_COLLECTION',



            reference:

                callback.reference,



            amount:

                payment.amount,



            currency:

                payment.currency,



            tenantId:

                context.tenant.id,



            metadata: {


                provider:

                    'AIRTEL',


                paymentId:

                    payment.id,


                correlationId:

                    context.correlationId


            }


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Journal Creation
     * -------------------------------------------------------------------------
     */

    async createSettlementJournal({

        payment,

        context

    }) {


        return this.journalService?.create?.({

            tenantId:

                context.tenant.id,


            type:

                'MOBILE_MONEY_COLLECTION',



            entries: [


                {


                    account:

                        'CASH_AIRTEL_SETTLEMENT',


                    debit:

                        payment.amount,


                    credit:

                        0


                },


                {


                    account:

                        'CUSTOMER_RECEIVABLE',


                    debit:

                        0,


                    credit:

                        payment.amount


                }


            ]



        });


    }

    /**
     * -------------------------------------------------------------------------
     * Settlement Reconciliation Trigger
     * -------------------------------------------------------------------------
     */

    async triggerSettlementReconciliation({

        callback,

        context,

        payment

    }) {


        await this.reconciliationService?.queue?.({

            provider:

                'AIRTEL',


            transactionReference:

                callback.reference,


            paymentId:

                payment.id,


            tenantId:

                context.tenant.id,


            correlationId:

                context.correlationId


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Event Publishing
     * -------------------------------------------------------------------------
     */

    async publishPaymentEvent({

        type,

        context,

        payment

    }) {


        await this.eventBus?.publish?.({

            type,


            payload: {


                payment,


                tenantId:

                    context.tenant.id,


                correlationId:

                    context.correlationId


            }


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Dead Letter Callback Handler
     * -------------------------------------------------------------------------
     */

    async sendToDeadLetter({

        callback,

        context,

        error

    }) {


        await this.deadLetterQueue?.publish?.({

            type:

                'AIRTEL_CALLBACK_FAILURE',


            payload: {


                callback,


                correlationId:

                    context.correlationId,


                error:

                    error.message,


                createdAt:

                    new Date()


            }


        });





        this.metrics?.counter?.(

            'airtel_callback_dead_letter_total'

        );


    }

    /**
     * -------------------------------------------------------------------------
     * Callback Completion
     * -------------------------------------------------------------------------
     */

    async completeLifecycle({

        lifecycleId,

        status,

        context

    }) {


        await this.callbackRepository?.updateStatus?.({

            id:

                lifecycleId,


            status,


            completedAt:

                new Date(),


            correlationId:

                context.correlationId


        });


    }

    /**
     * =========================================================================
     * Part 4 — Callback Reliability & Resilience Layer
     * =========================================================================
     *
     * Enterprise resilience controls:
     *
     * - Circuit breaking
     * - Retry orchestration
     * - Idempotency
     * - Distributed locking
     * - Recovery workflows
     * - Compensation
     *
     * =========================================================================
     */


    /**
     * -------------------------------------------------------------------------
     * Initialize Reliability Context
     * -------------------------------------------------------------------------
     */

    createReliabilityContext({

        callback,

        context

    }) {


        return Object.freeze({

            correlationId:

                context.correlationId,


            provider:

                'AIRTEL',


            callbackReference:

                callback.reference,


            startedAt:

                Date.now(),


            retryCount:

                0,


            recoveryAttempt:

                0


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Acquire Callback Processing Lock
     * -------------------------------------------------------------------------
     */

    async acquireCallbackLock({

        callback,

        context

    }) {


        if (

            !this.lockManager

        ) {


            return true;

        }



        const lockKey =

            `airtel:callback:${callback.reference}`;





        const acquired =

            await this.lockManager.acquire({

                key:

                    lockKey,


                ttl:

                    60000


            });





        if (!acquired) {


            this.metrics?.counter?.(

                'airtel_callback_lock_conflict_total'

            );



            throw new Error(

                'Callback already being processed'

            );


        }




        return true;


    }








    /**
     * -------------------------------------------------------------------------
     * Release Callback Lock
     * -------------------------------------------------------------------------
     */

    async releaseCallbackLock({

        callback

    }) {


        await this.lockManager?.release?.({

            key:

                `airtel:callback:${callback.reference}`

        });


    }

    /**
     * -------------------------------------------------------------------------
     * Validate Idempotency
     * -------------------------------------------------------------------------
     */

    async enforceIdempotency({

        callback,

        context

    }) {


        if (

            !this.idempotencyManager

        ) {


            return true;

        }



        const key =

            this.generateIdempotencyKey(callback);






        const exists =

            await this.idempotencyManager.exists({

                key

            });






        if (exists) {


            this.metrics?.counter?.(

                'airtel_callback_duplicate_total'

            );



            return false;


        }





        await this.idempotencyManager.reserve({

            key,


            ttl:

                86400

        });






        return true;


    }








    generateIdempotencyKey(callback) {


        return crypto

            .createHash('sha256')

            .update(

                [

                    'AIRTEL',

                    callback.reference,

                    callback.amount,

                    callback.timestamp


                ].join('|')

            )

            .digest('hex');


    }


    /**
     * -------------------------------------------------------------------------
     * Execute Protected Operation
     * -------------------------------------------------------------------------
     */

    async executeWithCircuitBreaker({

        operation,

        context

    }) {


        if (

            !this.circuitBreaker

        ) {


            return operation();


        }






        return this.circuitBreaker.execute({

            name:

                'airtel-callback-processing',


            action:

                operation,


            metadata: {


                correlationId:

                    context.correlationId


            }


        });


    }


    /**
     * -------------------------------------------------------------------------
     * Retry Callback Processing
     * -------------------------------------------------------------------------
     */

    async executeRetry({

        operation,

        context,

        attempts = 0

    }) {



        const maxRetries =

            this.retryPolicy?.maxAttempts

            ||

            5;






        try {


            return await operation();



        }

        catch (error) {



            if (

                attempts >= maxRetries

            ) {



                throw error;


            }






            const delay =

                Math.pow(

                    2,

                    attempts

                )

                *

                1000;






            this.metrics?.counter?.(

                'airtel_callback_retry_total'

            );






            await this.sleep(delay);






            return this.executeRetry({

                operation,

                context,

                attempts:

                    attempts + 1


            });


        }


    }








    sleep(ms) {


        return new Promise(resolve =>

            setTimeout(resolve, ms)

        );


    }


    /**
     * -------------------------------------------------------------------------
     * Timeout Wrapper
     * -------------------------------------------------------------------------
     */

    async executeWithTimeout({

        operation,

        timeout = 30000

    }) {


        return Promise.race([


            operation(),



            new Promise((_, reject) => {


                setTimeout(() => {


                    reject(

                        new Error(

                            'Callback processing timeout'

                        )

                    );


                }, timeout);


            })


        ]);


    }

    /**
     * -------------------------------------------------------------------------
     * Replay Dead Letter Callback
     * -------------------------------------------------------------------------
     */

    async replayDeadLetter({

        deadLetterId,

        context

    }) {


        const callback =

            await this.deadLetterQueue.get({

                id:

                    deadLetterId

            });





        if (!callback) {


            throw new Error(

                'Dead letter callback not found'

            );


        }





        this.metrics?.counter?.(

            'airtel_callback_dead_letter_replay_total'

        );






        return this.processCallback({

            callback,

            context

        });


    }

    /**
     * -------------------------------------------------------------------------
     * Execute Compensation
     * -------------------------------------------------------------------------
     */

    async compensateFailedCallback({

        payment,

        context,

        reason

    }) {


        await this.paymentStateEngine?.transition({

            paymentId:

                payment.id,


            event:

                'PROCESSING_COMPENSATION',


            metadata: {


                reason,


                correlationId:

                    context.correlationId


            }


        });






        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_COMPENSATION_STARTED',


            payload: {


                payment,


                reason


            }


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Provider Recovery Handler
     * -------------------------------------------------------------------------
     */

    async recoverProviderFailure({

        error,

        context

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_PROVIDER_FAILURE_DETECTED',


            payload: {


                correlationId:

                    context.correlationId,


                error:

                    error.message


            }


        });






        this.metrics?.counter?.(

            'airtel_provider_failure_total'

        );


    }

    /**
     * -------------------------------------------------------------------------
     * Record Reliability Metrics
     * -------------------------------------------------------------------------
     */

    recordReliabilityMetrics({

        status,

        duration

    }) {


        this.metrics?.histogram?.(

            'airtel_callback_reliability_duration_ms',

            duration

        );




        this.metrics?.counter?.(

            'airtel_callback_reliability_total',

            {

                status

            }

        );


    }

    /**
     * =========================================================================
     * Part 5 — Callback Security & Compliance Intelligence Layer
     * =========================================================================
     *
     * Enterprise financial security controls.
     *
     * Responsibilities:
     *
     * - Fraud enforcement
     * - AML screening
     * - Tenant policy validation
     * - Velocity control
     * - Approval governance
     * - Regulatory audit
     *
     * =========================================================================
     */


    /**
     * -------------------------------------------------------------------------
     * Create Security Context
     * -------------------------------------------------------------------------
     */

    createSecurityContext({

        callback,

        context

    }) {


        return Object.freeze({

            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            provider:

                'AIRTEL',


            transactionReference:

                callback.reference,


            securityChecks: [],


            riskScore: 0,


            decision:

                'PENDING',


            createdAt:

                new Date()

        });


    }

    /**
     * -------------------------------------------------------------------------
     * Execute Security Pipeline
     * -------------------------------------------------------------------------
     */

    async executeSecurityValidation({

        callback,

        context,

        correlation

    }) {


        const securityContext =

            this.createSecurityContext({

                callback,

                context

            });



        const [

            fraud,

            aml,

            velocity,

            policy,

            limits


        ] = await Promise.all([


            this.runFraudScreening({

                callback,

                context,

                correlation

            }),



            this.runAMLScreening({

                callback,

                context

            }),



            this.checkVelocityLimits({

                callback,

                context

            }),



            this.evaluateTenantPolicy({

                callback,

                context

            }),



            this.validateTransactionLimits({

                callback,

                context

            })


        ]);





        securityContext.securityChecks.push(

            fraud,

            aml,

            velocity,

            policy,

            limits

        );





        securityContext.riskScore =

            this.calculateSecurityRisk({

                fraud,

                aml,

                velocity,

                policy,

                limits

            });






        securityContext.decision =

            this.determineSecurityDecision({

                riskScore:

                    securityContext.riskScore

            });






        await this.recordSecurityAudit({

            context,

            securityContext

        });






        return securityContext;


    }

    /**
     * -------------------------------------------------------------------------
     * Fraud Screening
     * -------------------------------------------------------------------------
     */

    async runFraudScreening({

        callback,

        context,

        correlation

    }) {


        if (

            !this.fraudEngine

        ) {


            return {

                status:

                    'SKIPPED',

                score:

                    0

            };


        }





        const result =

            await this.fraudEngine.evaluate({

                provider:

                    'AIRTEL',


                tenantId:

                    context.tenant.id,


                transaction:

                    callback,


                correlation

            });






        if (

            result.block

        ) {


            await this.publishSecurityEvent({

                type:

                    'AIRTEL_FRAUD_BLOCK',


                context,

                result

            });


        }





        return result;


    }

    /**
     * -------------------------------------------------------------------------
     * AML Screening
     * -------------------------------------------------------------------------
     */

    async runAMLScreening({

        callback,

        context

    }) {


        if (

            !this.amlService

        ) {


            return {

                status:

                    'NOT_CONFIGURED',

                risk:

                    0

            };


        }






        return this.amlService.screen({

            tenantId:

                context.tenant.id,


            provider:

                'AIRTEL',


            transaction:

                callback,


            correlationId:

                context.correlationId


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Velocity Check
     * -------------------------------------------------------------------------
     */

    async checkVelocityLimits({

        callback,

        context

    }) {


        if (

            !this.velocityEngine

        ) {


            return {

                status:

                    'SKIPPED'

            };


        }





        return this.velocityEngine.check({

            tenantId:

                context.tenant.id,


            customerId:

                callback.customerId,


            amount:

                callback.amount,


            provider:

                'AIRTEL'


        });


    }


    /**
     * -------------------------------------------------------------------------
     * Tenant Policy Evaluation
     * -------------------------------------------------------------------------
     */

    async evaluateTenantPolicy({

        callback,

        context

    }) {


        if (

            !this.policyEngine

        ) {


            return {

                status:

                    'DEFAULT_ALLOW'

            };


        }





        return this.policyEngine.evaluate({

            tenantId:

                context.tenant.id,


            operation:

                'AIRTEL_COLLECTION',


            transaction:

                callback


        });


    }

    /**
     * -------------------------------------------------------------------------
     * Transaction Limit Validation
     * -------------------------------------------------------------------------
     */

    async validateTransactionLimits({

        callback,

        context

    }) {


        const limits =

            await this.limitService?.getLimits?.({

                tenantId:

                    context.tenant.id

            });






        if (

            !limits

        ) {


            return {

                status:

                    'NO_LIMIT_POLICY'

            };


        }





        if (

            callback.amount >

            limits.maximumTransactionAmount

        ) {


            return {


                status:

                    'BLOCKED',


                reason:

                    'AMOUNT_LIMIT_EXCEEDED'


            };


        }





        return {


            status:

                'APPROVED'


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Maker Checker Approval
     * -------------------------------------------------------------------------
     */

    async requireApproval({

        securityContext,

        context

    }) {


        if (

            securityContext.riskScore <

            50

        ) {


            return {


                approved:

                    true


            };


        }






        const approval =

            await this.approvalWorkflow.create({

                type:

                    'AIRTEL_CALLBACK_APPROVAL',


                correlationId:

                    context.correlationId,


                riskScore:

                    securityContext.riskScore


            });






        return {


            approved:

                false,


            approvalId:

                approval.id,


            status:

                'PENDING_APPROVAL'


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Security Decision
     * -------------------------------------------------------------------------
     */

    calculateSecurityRisk({

        fraud,

        aml,

        velocity,

        policy,

        limits

    }) {


        return Math.min(

            100,


            (

                fraud.score || 0

            )

            +

            (

                aml.risk || 0

            )

            +

            (

                velocity.risk || 0

            )

        );


    }








    determineSecurityDecision({

        riskScore

    }) {


        if (

            riskScore >= 80

        ) {


            return 'BLOCK';


        }



        if (

            riskScore >= 50

        ) {


            return 'REVIEW';


        }





        return 'ALLOW';


    }

    /**
     * -------------------------------------------------------------------------
     * Callback Authorization Signature
     * -------------------------------------------------------------------------
     */

    generateSecuritySignature({

        payload

    }) {


        return crypto

            .createHmac(

                'sha256',

                this.securitySecret

            )

            .update(

                JSON.stringify(payload)

            )

            .digest('hex');


    }

    /**
     * -------------------------------------------------------------------------
     * Compliance Audit
     * -------------------------------------------------------------------------
     */

    async recordSecurityAudit({

        context,

        securityContext

    }) {


        await this.auditService?.record({

            action:

                'AIRTEL_CALLBACK_SECURITY_CHECK',


            tenantId:

                context.tenant.id,


            correlationId:

                context.correlationId,


            metadata:

                securityContext


        });



    }

    /**
     * -------------------------------------------------------------------------
     * Compliance Snapshot
     * -------------------------------------------------------------------------
     */

    async complianceReport({

        tenantId

    }) {


        return {


            provider:

                'AIRTEL',


            tenantId,


            securityChecks:

                this.securityStatistics,


            generatedAt:

                new Date()


        };


    }

    /**
     * =========================================================================
     * Part 6 — Callback Operations & Intelligence Control Plane
     * =========================================================================
     *
     * Enterprise operational management layer.
     *
     * Responsibilities:
     *
     * - Runtime monitoring
     * - Health management
     * - SLA monitoring
     * - Provider intelligence
     * - Dashboards
     * - Incident response
     * - Graceful shutdown
     *
     * =========================================================================
     */


    /**
     * -------------------------------------------------------------------------
     * Operations Context
     * -------------------------------------------------------------------------
     */

    createOperationsContext() {


        return {


            startedAt:

                this.startedAt || new Date(),



            status:

                'ACTIVE',



            activeCallbacks:

                0,



            totalProcessed:

                0,



            totalFailures:

                0,



            incidents:

                [],



            shutdownRequested:

                false



        };


    }

    /**
     * -------------------------------------------------------------------------
     * Register Callback Operation
     * -------------------------------------------------------------------------
     */

    registerCallbackOperation({

        context

    }) {


        this.operations.activeCallbacks++;


        this.operations.totalProcessed++;



        this.metrics?.gauge?.(

            'airtel_callback_active_operations',

            this.operations.activeCallbacks

        );



        return {


            operationId:

                context.correlationId,


            startedAt:

                Date.now()


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Complete Callback Operation
     * -------------------------------------------------------------------------
     */

    completeCallbackOperation({

        success,

        duration

    }) {


        this.operations.activeCallbacks--;



        if (!success) {


            this.operations.totalFailures++;


        }





        this.metrics?.histogram?.(

            'airtel_callback_processing_time_ms',

            duration

        );



    }

    /**
   * -------------------------------------------------------------------------
   * Health Status
   * -------------------------------------------------------------------------
   */
    async health() {
        const [ledger, paymentEngine, reconciliation] = await Promise.all([
            this.checkDependency(this.ledgerService),
            this.checkDependency(this.paymentStateEngine),
            this.checkDependency(this.reconciliationService),
        ]);

        const dependencies = {
            ledger,
            paymentEngine,
            reconciliation,
        };

        const healthy = Object.values(dependencies).every(
            dep => dep && dep.status === "UP"
        );

        return {
            service: "AIRTEL_CALLBACK_PROCESSOR",
            status: healthy ? "UP" : "DEGRADED",
            dependencies,
            uptime: this.startedAt instanceof Date
                ? Date.now() - this.startedAt.getTime()
                : 0,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Dependency Health Check
     * -------------------------------------------------------------------------
     */
    async checkDependency(service) {
        if (!service) {
            return {
                status: "UNKNOWN",
                message: "Service not configured",
            };
        }

        try {
            if (typeof service.health === "function") {
                const result = await service.health();

                return result || {
                    status: "UNKNOWN",
                    message: "Health check returned no result",
                };
            }

            return {
                status: "UP",
                message: "Health endpoint not implemented",
            };
        } catch (error) {
            return {
                status: "DOWN",
                message: error.message,
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * SLA Evaluation
     * -------------------------------------------------------------------------
     */

    evaluateSLA({

        duration,

        context

    }) {


        const threshold =

            this.configuration?.callbackSLA

            ||

            5000;




        const breached =

            duration >

            threshold;






        if (breached) {


            this.raiseIncident({

                type:

                    'SLA_BREACH',


                context,


                metadata: {


                    duration,

                    threshold


                }


            });


        }





        this.metrics?.counter?.(

            'airtel_callback_sla_status_total',

            {

                status:

                    breached

                        ?

                        'BREACH'

                        :

                        'OK'


            }

        );





        return {


            breached,


            duration


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Provider Reliability Score
     * -------------------------------------------------------------------------
     */

    calculateProviderScore() {


        const total =

            this.operations.totalProcessed;



        if (!total) {


            return 100;


        }




        const failureRate =

            this.operations.totalFailures

            /

            total;





        const score =

            100 -

            (

                failureRate *

                100

            );






        return Math.max(

            Math.round(score),

            0

        );


    }

    /**
     * -------------------------------------------------------------------------
     * Operations Dashboard
     * -------------------------------------------------------------------------
     */

    async dashboard() {


        return {


            service:

                'AIRTEL_CALLBACK_PROCESSOR',



            health:

                await this.health(),



            operations:

            {


                active:

                    this.operations.activeCallbacks,



                processed:

                    this.operations.totalProcessed,



                failures:

                    this.operations.totalFailures


            },



            providerScore:

                this.calculateProviderScore(),



            incidents:

                this.operations.incidents,



            generatedAt:

                new Date()


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Create Incident
     * -------------------------------------------------------------------------
     */

    async raiseIncident({

        type,

        context,

        metadata = {}

    }) {


        const incident = {


            id:

                crypto.randomUUID(),



            type,



            severity:

                'HIGH',



            correlationId:

                context?.correlationId,



            metadata,



            createdAt:

                new Date()


        };





        this.operations.incidents.push(

            incident

        );





        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_INCIDENT_CREATED',


            payload:

                incident


        });





        this.metrics?.counter?.(

            'airtel_callback_incidents_total'

        );




        return incident;


    }

    /**
     * -------------------------------------------------------------------------
     * Send Alert
     * -------------------------------------------------------------------------
     */

    async sendAlert({

        severity,

        message,

        metadata

    }) {


        await this.alertService?.notify?.({

            service:

                'AIRTEL_CALLBACK',


            severity,


            message,


            metadata


        });



    }

    /**
     * -------------------------------------------------------------------------
     * Executive Report
     * -------------------------------------------------------------------------
     */

    async executiveReport() {


        const health =

            await this.health();





        return {


            provider:

                'AIRTEL',



            availability:

                health.status,



            processed:

                this.operations.totalProcessed,



            failed:

                this.operations.totalFailures,



            reliabilityScore:

                this.calculateProviderScore(),



            incidents:

                this.operations.incidents.length,



            generatedAt:

                new Date()


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Performance Analytics
     * -------------------------------------------------------------------------
     */

    performanceAnalytics() {


        return {


            throughput:

                this.operations.totalProcessed /

                (

                    (

                        Date.now()

                        -

                        this.startedAt.getTime()

                    )

                    /

                    1000

                ),




            failureRate:

                this.operations.totalProcessed

                    ?

                    (

                        this.operations.totalFailures

                        /

                        this.operations.totalProcessed

                    )

                    :

                    0,



            providerScore:

                this.calculateProviderScore()


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics Snapshot
     * -------------------------------------------------------------------------
     */

    async diagnostics() {


        return {


            service:

                'AIRTEL_CALLBACK_PROCESSOR',



            health:

                await this.health(),



            dashboard:

                await this.dashboard(),



            performance:

                this.performanceAnalytics(),



            timestamp:

                new Date()


        };


    }

    /**
     * -------------------------------------------------------------------------
     * Graceful Shutdown
     * -------------------------------------------------------------------------
     */

    async shutdown({

        timeout = 30000

    } = {}) {


        this.operations.shutdownRequested = true;


        this.operations.status =

            'STOPPING';






        const start = Date.now();





        while (

            this.operations.activeCallbacks > 0

            &&

            Date.now() - start < timeout

        ) {


            await new Promise(resolve =>

                setTimeout(resolve, 500)

            );


        }





        this.operations.status =

            'STOPPED';





        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_PROCESSOR_SHUTDOWN',


            payload: {


                timestamp:

                    new Date()


            }


        });





        return true;


    }


}


module.exports = CallbackProcessor;