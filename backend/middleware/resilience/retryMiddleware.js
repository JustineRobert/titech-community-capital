"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Middleware Integration Layer
 * =============================================================================
 *
 * Integrates Enterprise Retry Framework with application workflows.
 *
 * Responsibilities:
 *
 * ✓ Express middleware integration
 * ✓ Request context propagation
 * ✓ Tenant propagation
 * ✓ Authentication propagation
 * ✓ Correlation ID propagation
 * ✓ Idempotency enforcement
 * ✓ API retry wrapper
 * ✓ Payment operation wrapper
 * ✓ Database operation wrapper
 * ✓ Background job wrapper
 * ✓ Webhook wrapper
 * ✓ Graceful shutdown awareness
 *
 * =============================================================================
 */


const crypto = require("crypto");


const {
    retryExecutionEngine
} = require("./retryExecutionEngine");


const {
    RetryContextFactory
} = require("./retryContextFactory");


const {
    RetryPolicyRegistry
} = require("./retryPolicyRegistry");



/* =============================================================================
 * Middleware
 * =============================================================================
 */


class RetryMiddleware {


    constructor(options = {}) {


        this.executionEngine =
            options.executionEngine
            ||
            retryExecutionEngine;



        this.contextFactory =
            options.contextFactory
            ||
            new RetryContextFactory();



        this.policyRegistry =
            options.policyRegistry
            ||
            new RetryPolicyRegistry();



        this.shutdownManager =
            options.shutdownManager
            ||
            null;


    }





    /* =========================================================================
     * Express Middleware
     * =========================================================================
     */


    middleware(
        options = {}
    ) {


        return async (

            req,

            res,

            next

        ) => {


            const context =
                this.createRequestContext(

                    req,

                    options

                );



            req.retryContext =
                context;



            req.retry =
            async (

                operation,

                retryOptions = {}

            ) => {


                return this.executionEngine.execute(

                    operation,

                    {

                        context,

                        ...retryOptions

                    }

                );


            };



            next();


        };


    }





    /* =========================================================================
     * Request Context Integration
     * =========================================================================
     */


    createRequestContext(
        req,
        options={}
    ) {


        return this.contextFactory.create({

            retryId:
                crypto.randomUUID(),


            executionId:
                crypto.randomUUID(),


            requestId:
                req.id
                ||
                req.requestId,


            correlationId:
                req.correlationId,


            traceId:
                req.traceId,


            tenantId:
                req.tenant?.id
                ||
                req.tenantId,


            userId:
                req.user?.id,


            service:
                options.service
                ||
                "api",


            component:
                options.component
                ||
                "middleware",


            operation:
                req.originalUrl,


            metadata:
                {

                    method:
                        req.method,


                    ip:
                        req.ip

                }


        });


    }





    /* =========================================================================
     * Authentication Propagation
     * =========================================================================
     */


    withAuthentication(
        context,
        user
    ) {


        context.userId =
            user?.id;



        context.roles =
            user?.roles;



        return context;

    }





    /* =========================================================================
     * Tenant Propagation
     * =========================================================================
     */


    withTenant(
        context,
        tenant
    ) {


        context.tenantId =
            tenant?.id;



        return context;

    }





    /* =========================================================================
     * Correlation Propagation
     * =========================================================================
     */


    withCorrelation(
        context,
        correlationId
    ) {


        context.correlationId =
            correlationId;



        return context;

    }





    /* =========================================================================
     * Idempotency Enforcement
     * =========================================================================
     */


    validateIdempotency(
        req,
        options={}
    ) {


        if (
            !options.required
        ) {

            return true;

        }



        const key =

            req.headers[
                "idempotency-key"
            ];



        if (
            !key
        ) {


            throw new Error(

                "Idempotency-Key required for retryable operation"

            );

        }



        return true;


    }





    /* =========================================================================
     * API Route Wrapper
     * =========================================================================
     */


    api(
        handler,
        options={}
    ) {


        return async (

            req,

            res,

            next

        ) => {


            try {


                this.validateIdempotency(

                    req,

                    options

                );



                const result =
                    await this.executionEngine.execute(

                        () => handler(

                            req,

                            res

                        ),

                        {

                            context:
                                req.retryContext,


                            ...options

                        }

                    );



                return result;


            }

            catch(error) {


                next(error);

            }


        };


    }





    /* =========================================================================
     * Payment Wrapper
     * =========================================================================
     */


    payment(
        operation,
        options={}
    ) {


        return this.executionEngine.execute(

            operation,

            {

                policy:
                    this.policyRegistry.getPolicy(

                        "paymentGatewayPolicy"

                    ),


                idempotencyRequired:
                    true,


                ...options

            }

        );


    }





    /* =========================================================================
     * Database Wrapper
     * =========================================================================
     */


    database(
        operation,
        options={}
    ) {


        return this.executionEngine.execute(

            operation,

            {

                policy:
                    this.policyRegistry.getPolicy(

                        "databasePolicy"

                    ),


                ...options

            }

        );


    }





    /* =========================================================================
     * Background Job Wrapper
     * =========================================================================
     */


    job(
        operation,
        options={}
    ) {


        return this.executionEngine.execute(

            operation,

            {

                policy:
                    this.policyRegistry.getPolicy(

                        "notificationPolicy"

                    ),


                ...options

            }

        );


    }





    /* =========================================================================
     * Webhook Wrapper
     * =========================================================================
     */


    webhook(
        operation,
        options={}
    ) {


        return this.executionEngine.execute(

            operation,

            {

                policy:
                    this.policyRegistry.getPolicy(

                        "webhookPolicy"

                    ),


                idempotencyRequired:
                    true,


                ...options

            }

        );


    }





    /* =========================================================================
     * Shutdown
     * =========================================================================
     */


    shutdown()
    {


        this.shutdownManager?.shutdown?.();



    }


}





/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryMiddleware =
    new RetryMiddleware();





/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryMiddleware(
    options={}
) {


    return new RetryMiddleware(
        options
    );


}





module.exports = {


    RetryMiddleware,

    retryMiddleware,

    createRetryMiddleware

};