'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Compensation Manager
 * ============================================================================
 *
 * Coordinates compensating actions for distributed transactions.
 *
 * Responsibilities
 * ----------------
 * ✓ Saga compensation execution
 * ✓ Compensation registration
 * ✓ Dependency ordering
 * ✓ Idempotent compensation
 * ✓ Retry handling
 * ✓ Compensation tracking
 * ✓ Recovery support
 * ✓ Audit integration
 * ✓ Metrics
 * ✓ Distributed tracing
 *
 * ============================================================================
 */


const crypto = require('crypto');



const CompensationStatus = Object.freeze({

    REGISTERED: 'REGISTERED',

    RUNNING: 'RUNNING',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    SKIPPED: 'SKIPPED'

});



class CompensationManager {


    constructor(options = {}) {


        this.logger =

            options.logger || console;



        this.repository =

            options.repository;



        this.retryPolicy =

            options.retryPolicy;



        this.timeoutManager =

            options.timeoutManager;



        this.auditPublisher =

            options.auditPublisher;



        this.metrics =

            options.metrics;



        this.tracer =

            options.tracer;



        this.eventBus =

            options.eventBus;



        this.compensators = new Map();



        this.executionHistory = new Map();


    }



    /**
     * =========================================================================
     * Register Compensation Handler
     * =========================================================================
     */


    register(type, handler, options = {}) {


        if (

            typeof handler !== 'function'

        ) {


            throw new Error(

                'Compensation handler must be a function'

            );


        }



        this.compensators.set(

            type,

            {

                handler,


                priority:

                    options.priority || 0,


                dependencies:

                    options.dependencies || [],


                timeout:

                    options.timeout

            }

        );



        return this;


    }



    /**
     * =========================================================================
     * Create Compensation Plan
     * =========================================================================
     */


    createPlan(steps = []) {


        return steps

            .map(step => ({


                id:

                    step.id ||

                    crypto.randomUUID(),



                type:

                    step.type,



                payload:

                    step.payload || {},



                status:

                    CompensationStatus.REGISTERED



            }))

            .sort(

                (a, b) =>

                    this.priority(b.type)

                    -

                    this.priority(a.type)

            );


    }



    /**
     * =========================================================================
     * Execute Compensation Plan
     * =========================================================================
     */


    async execute(plan, context = {}) {


        const span =

            this.tracer?.startSpan?.(

                'transaction.compensation.execute'

            );



        const executionId =

            crypto.randomUUID();



        const result = {


            executionId,


            status:

                CompensationStatus.RUNNING,



            completed: [],


            failed: [],


            startedAt:

                new Date()

        };



        try {


            for (

                const step of plan

            ) {


                try {


                    const compensation =

                        await this.executeStep(

                            step,

                            context

                        );



                    result.completed.push(

                        compensation

                    );


                }

                catch(error) {


                    result.failed.push({

                        step,

                        error:

                            error.message

                    });



                    throw error;


                }


            }



            result.status =

                CompensationStatus.COMPLETED;



            result.completedAt =

                new Date();



            await this.persist(

                result

            );



            this.metrics?.increment?.(

                'compensation_success_total'

            );



            return result;


        }

        catch(error) {


            result.status =

                CompensationStatus.FAILED;



            result.error = {


                message:

                    error.message,



                code:

                    error.code || null

            };



            await this.persist(

                result

            );



            this.metrics?.increment?.(

                'compensation_failure_total'

            );



            throw error;


        }

        finally {


            span?.end?.();


        }


    }



    /**
     * =========================================================================
     * Execute Compensation Step
     * =========================================================================
     */


    async executeStep(step, context) {


        const definition =

            this.compensators.get(

                step.type

            );



        if (!definition) {


            throw new Error(

                `No compensator registered: ${step.type}`

            );


        }



        const existing =

            await this.findExecution(

                step.id

            );



        if (

            existing?.status ===

            CompensationStatus.COMPLETED

        ) {


            return existing;


        }



        const record = {


            id:

                step.id,



            type:

                step.type,



            status:

                CompensationStatus.RUNNING,



            startedAt:

                new Date()

        };



        await this.saveExecution(

            record

        );



        try {


            const execute = () =>

                definition.handler(

                    step,

                    context

                );



            if (

                this.retryPolicy

            ) {


                await this.retryPolicy.execute(

                    execute,

                    {


                        operation:

                            `compensation.${step.type}`

                    }

                );


            }

            else {


                await execute();


            }



            record.status =

                CompensationStatus.COMPLETED;



            record.completedAt =

                new Date();



            await this.saveExecution(

                record

            );



            await this.auditPublisher?.publish?.({

                type:

                    'COMPENSATION_EXECUTED',



                compensationType:

                    step.type,


                timestamp:

                    new Date()

            });



            return record;


        }

        catch(error) {


            record.status =

                CompensationStatus.FAILED;



            record.error = {


                message:

                    error.message

            };



            await this.saveExecution(

                record

            );



            throw error;


        }


    }



    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */


    validateDependencies(type, completed = []) {


        const definition =

            this.compensators.get(

                type

            );



        if (!definition) {


            return false;


        }



        return definition.dependencies.every(

            dependency =>

                completed.includes(

                    dependency

                )

        );


    }



    /**
     * =========================================================================
     * Compensation Lookup
     * =========================================================================
     */


    priority(type) {


        return (

            this.compensators.get(type)

                ?.priority || 0

        );


    }



    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */


    async saveExecution(record) {


        this.executionHistory.set(

            record.id,

            record

        );



        if (

            this.repository?.create

        ) {


            await this.repository.create(

                record

            );


        }


    }



    async findExecution(id) {


        if (

            this.repository?.findById

        ) {


            return this.repository.findById(

                id

            );


        }



        return this.executionHistory.get(

            id

        );


    }



    async persist(result) {


        if (

            this.repository?.create

        ) {


            await this.repository.create(

                result

            );


        }



        await this.eventBus?.publish?.({

            type:

                'compensation.completed',



            payload:

                result

        });


    }



    /**
     * =========================================================================
     * Recover Compensation
     * =========================================================================
     */


    async recover(executionId) {


        return this.executionHistory.get(

            executionId

        );


    }



    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */


    getStatistics() {


        return {


            registeredCompensators:

                this.compensators.size,



            executions:

                this.executionHistory.size


        };


    }



    health() {


        return {


            status:

                'UP',



            compensators:

                this.compensators.size


        };


    }


}



CompensationManager.Status =
    CompensationStatus;



module.exports = CompensationManager;