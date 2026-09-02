"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Context Factory & Builder
 * =============================================================================
 *
 * Creates production-grade immutable RetryContext instances.
 *
 * Supported sources:
 *
 * ✓ Express requests
 * ✓ Enterprise RequestContext
 * ✓ Tenant context
 * ✓ Authentication context
 * ✓ OpenTelemetry trace context
 * ✓ Background jobs
 * ✓ Webhooks
 * ✓ Payment workflows
 *
 * Features:
 *
 * ✓ Context normalization
 * ✓ Context merging
 * ✓ Validation
 * ✓ Enrichment
 * ✓ Immutable freezing
 * ✓ Metadata propagation
 *
 * =============================================================================
 */


const {
    RetryContext,
    createRetryContext,
    isRetryContext
} = require("./retryContext");



const {
    RetryValidationError
} = require("./retryErrors");



/* =============================================================================
 * Retry Context Factory Error
 * =============================================================================
 */

class RetryContextFactoryError extends Error {


    constructor(
        message,
        options = {}
    ) {

        super(message);


        this.name =
            "RetryContextFactoryError";


        this.code =
            "RETRY_CONTEXT_FACTORY_ERROR";


        this.cause =
            options.cause ||
            null;


        Error.captureStackTrace(
            this,
            this.constructor
        );

    }

}



/* =============================================================================
 * RetryContextFactory
 * =============================================================================
 */

class RetryContextFactory {


    constructor(options = {}) {


        this.defaultPolicy =
            options.defaultPolicy ||
            "default";


        this.defaultStrategy =
            options.defaultStrategy ||
            "adaptive";


        this.serviceName =
            options.serviceName ||
            "unknown-service";


        this.component =
            options.component ||
            "retry-engine";


    }



    /* =========================================================================
     * create()
     * =========================================================================
     */


    create(options = {}) {


        const context =
            createRetryContext({

                service:
                    this.serviceName,


                component:
                    this.component,


                policyName:
                    this.defaultPolicy,


                strategy:
                    this.defaultStrategy,


                ...options

            });



        return this.freeze(
            context
        );

    }




    /* =========================================================================
     * Express Request Context
     * =========================================================================
     */


    fromRequest(
        req,
        options = {}
    ) {


        if (
            !req
        ) {

            throw new RetryContextFactoryError(
                "Request object required"
            );

        }



        return this.create({

            requestId:
                req.id
                ||
                req.requestId
                ||
                null,


            correlationId:
                req.correlationId
                ||
                null,


            tenantId:
                req.tenantId
                ||
                req.context?.tenantId
                ||
                null,


            userId:
                req.user?.id
                ||
                null,


            metadata: {

                httpMethod:
                    req.method,


                path:
                    req.originalUrl

            },


            ...options

        });

    }



    /* =========================================================================
     * Enterprise RequestContext Integration
     * =========================================================================
     */


    fromRequestContext(
        requestContext,
        options = {}
    ) {


        if (
            !requestContext
        ) {

            throw new RetryContextFactoryError(
                "RequestContext required"
            );

        }



        return this.create({

            requestId:
                requestContext.requestId,


            correlationId:
                requestContext.correlationId,


            tenantId:
                requestContext.tenantId,


            userId:
                requestContext.userId,


            traceId:
                requestContext.traceId,


            spanId:
                requestContext.spanId,


            metadata: {

                source:
                    "request-context"

            },


            ...options

        });

    }




    /* =========================================================================
     * OpenTelemetry Trace Context
     * =========================================================================
     */


    fromTraceContext(
        traceContext,
        options = {}
    ) {


        if (
            !traceContext
        ) {

            throw new RetryContextFactoryError(
                "Trace context required"
            );

        }



        return this.create({

            traceId:
                traceContext.traceId,


            spanId:
                traceContext.spanId,


            metadata: {

                tracing:
                    true

            },


            ...options

        });

    }




    /* =========================================================================
     * Tenant Context
     * =========================================================================
     */


    fromTenantContext(
        tenantContext,
        options = {}
    ) {


        if (
            !tenantContext
        ) {

            throw new RetryContextFactoryError(
                "Tenant context required"
            );

        }



        return this.create({

            tenantId:
                tenantContext.tenantId,


            metadata: {

                tenantAware:
                    true

            },


            ...options

        });

    }




    /* =========================================================================
     * Background Job Context
     * =========================================================================
     */


    fromJob(
        job,
        options = {}
    ) {


        if (
            !job
        ) {

            throw new RetryContextFactoryError(
                "Job context required"
            );

        }



        return this.create({

            operation:
                job.name
                ||
                job.id,


            metadata: {

                jobId:
                    job.id,


                queue:
                    job.queueName
                    ||
                    null

            },


            ...options

        });

    }




    /* =========================================================================
     * Webhook Context
     * =========================================================================
     */


    fromWebhook(
        webhook,
        options = {}
    ) {


        if (
            !webhook
        ) {

            throw new RetryContextFactoryError(
                "Webhook context required"
            );

        }



        return this.create({

            operation:
                "webhook-processing",


            metadata: {

                provider:
                    webhook.provider,


                event:
                    webhook.event

            },


            ...options

        });

    }




    /* =========================================================================
     * Merge Contexts
     * =========================================================================
     */


    merge(
        base,
        override
    ) {


        if (
            !isRetryContext(base)
        ) {

            throw new RetryContextFactoryError(
                "Base context invalid"
            );

        }



        return this.create({

            ...base,


            ...override,


            metadata: {

                ...base.metadata,

                ...(override.metadata || {})

            }

        });

    }




    /* =========================================================================
     * Validate Context
     * =========================================================================
     */


    validate(
        context
    ) {


        if (
            !isRetryContext(context)
        ) {

            throw new RetryValidationError(
                "Invalid RetryContext",
                {

                    field:
                        "context"

                }
            );

        }



        if (
            !context.retryId
        ) {

            throw new RetryValidationError(
                "Missing retryId"
            );

        }



        if (
            !context.executionId
        ) {

            throw new RetryValidationError(
                "Missing executionId"
            );

        }



        return true;

    }




    /* =========================================================================
     * Enrich Context
     * =========================================================================
     */


    enrich(
        context,
        metadata = {}
    ) {


        this.validate(
            context
        );


        return context.enrich({

            metadata

        });

    }




    /* =========================================================================
     * Freeze Context
     * =========================================================================
     */


    freeze(
        context
    ) {


        this.validate(
            context
        );


        return Object.freeze(
            context
        );

    }


}



/* =============================================================================
 * Singleton Factory
 * =============================================================================
 */

const retryContextFactory =
    new RetryContextFactory();



/* =============================================================================
 * Factory Creator
 * =============================================================================
 */

function createRetryContextFactory(
    options = {}
) {

    return new RetryContextFactory(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = {


    RetryContextFactory,

    RetryContextFactoryError,

    retryContextFactory,

    createRetryContextFactory

};