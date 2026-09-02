"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry API Facade & Developer SDK
 * =============================================================================
 *
 * Developer-facing API for Enterprise Retry Framework.
 *
 * Provides simplified access for:
 *
 * ✓ Controllers
 * ✓ Services
 * ✓ Repositories
 * ✓ Payment providers
 * ✓ Background workers
 * ✓ Scheduled jobs
 * ✓ Webhooks
 *
 * Features:
 *
 * ✓ retry()
 * ✓ execute()
 * ✓ database()
 * ✓ payment()
 * ✓ webhook()
 * ✓ apiCall()
 * ✓ job()
 * ✓ withPolicy()
 * ✓ withContext()
 * ✓ withTimeout()
 * ✓ withIdempotency()
 * ✓ withTracing()
 * ✓ withMetrics()
 *
 * =============================================================================
 */



const crypto = require("crypto");



const {
    retryExecutionEngine
} = require("./retryExecutionEngine");



const {
    retryPolicyRegistry
} = require("./retryPolicyRegistry");



const {
    RetryContextFactory
} = require("./retryContextFactory");





class RetryClient {


    constructor(options={}) {


        this.engine =
            options.engine
            ||
            retryExecutionEngine;



        this.registry =
            options.registry
            ||
            retryPolicyRegistry;



        this.contextFactory =
            options.contextFactory
            ||
            new RetryContextFactory();



        this.defaults =
            options.defaults
            ||
            {};



    }





    /* =========================================================================
     * Generic Retry
     * =========================================================================
     */


    async retry(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            options

        );


    }





    /* =========================================================================
     * Execute Operation
     * =========================================================================
     */


    async execute(
        operation,
        options={}
    ) {


        const context =
            this.buildContext(
                options
            );



        return this.engine.execute(

            operation,

            {


                context,


                ...options


            }

        );


    }





    /* =========================================================================
     * Database Operations
     * =========================================================================
     */


    async database(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            {


                policy:

                    this.registry.getPolicy(

                        "databasePolicy"

                    ),


                ...options


            }

        );


    }





    /* =========================================================================
     * Payment Operations
     * =========================================================================
     */


    async payment(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            {


                policy:

                    this.registry.getPolicy(

                        "paymentGatewayPolicy"

                    ),


                idempotency:

                    true,


                ...options


            }

        );


    }





    /* =========================================================================
     * Webhook Operations
     * =========================================================================
     */


    async webhook(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            {


                policy:

                    this.registry.getPolicy(

                        "webhookPolicy"

                    ),


                idempotency:

                    true,


                ...options


            }

        );


    }





    /* =========================================================================
     * External API Calls
     * =========================================================================
     */


    async apiCall(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            {


                policy:

                    this.registry.getPolicy(

                        "externalApiPolicy"

                    ),


                ...options


            }

        );


    }





    /* =========================================================================
     * Background Jobs
     * =========================================================================
     */


    async job(
        operation,
        options={}
    ) {


        return this.execute(

            operation,

            {


                policy:

                    this.registry.getPolicy(

                        "notificationPolicy"

                    ),


                ...options


            }

        );


    }





    /* =========================================================================
     * Context Builder
     * =========================================================================
     */


    buildContext(
        options={}
    ) {


        return this.contextFactory.create({

            retryId:
                crypto.randomUUID(),


            executionId:
                crypto.randomUUID(),


            policyName:
                options.policy?.name,


            operation:
                options.operation,


            service:
                options.service,


            component:
                options.component,


            tenantId:
                options.tenantId,


            userId:
                options.userId,


            metadata:
                options.metadata,


            ...this.defaults,


            ...options.context


        });


    }





    /* =========================================================================
     * Fluent Configuration API
     * =========================================================================
     */


    withPolicy(
        policy
    ) {


        return this.clone({

            policy

        });


    }





    withContext(
        context
    ) {


        return this.clone({

            context

        });


    }





    withTimeout(
        timeout
    ) {


        return this.clone({

            timeout

        });


    }





    withIdempotency(
        enabled=true
    ) {


        return this.clone({

            idempotency:

                enabled

        });


    }





    withTracing(
        enabled=true
    ) {


        return this.clone({

            tracing:

                enabled

        });


    }





    withMetrics(
        enabled=true
    ) {


        return this.clone({

            metrics:

                enabled

        });


    }





    clone(
        changes={}
    ) {


        return new RetryClient({

            engine:
                this.engine,


            registry:
                this.registry,


            contextFactory:
                this.contextFactory,


            defaults:

                {

                    ...this.defaults,

                    ...changes

                }


        });


    }



}





/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryClient =
    new RetryClient();





function createRetryClient(
    options={}
) {


    return new RetryClient(
        options
    );


}





module.exports = {


    RetryClient,

    retryClient,

    createRetryClient

};