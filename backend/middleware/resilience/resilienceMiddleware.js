/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Middleware Integration Layer
 *
 * File:
 *
 * backend/middleware/resilience/resilienceMiddleware.js
 *
 * Responsibilities:
 *
 * ✓ Express integration
 * ✓ Request lifecycle management
 * ✓ Automatic resilience execution
 * ✓ Tenant propagation
 * ✓ Correlation propagation
 * ✓ Error interception
 * ✓ Response normalization
 * ✓ Metrics integration
 *
 * Integrates:
 *
 * - Circuit Breaker
 * - Retry Runtime
 * - Graceful Degradation Engine
 * - Policy Engine
 * - Decision Orchestrator
 *
 * =============================================================================
 */

'use strict';


const crypto = require('crypto');
const EventEmitter = require('events');



const RESILIENCE_STATUS = Object.freeze({

    SUCCESS:
        'SUCCESS',

    DEGRADED:
        'DEGRADED',

    BLOCKED:
        'BLOCKED',

    FAILED:
        'FAILED'

});



const DEFAULTS = Object.freeze({

    enabled:true,

    captureResponse:true,

    transformErrors:true,

    attachContext:true,

    exposeDiagnostics:false

});





/**
 * =============================================================================
 * Resilience Middleware
 * =============================================================================
 */


class ResilienceMiddleware extends EventEmitter {


    constructor(options = {}) {


        super();


        if(!options.orchestrator)
        {

            throw new Error(

                'Resilience orchestrator required'

            );
        }



        this.orchestrator =
            options.orchestrator;



        this.logger =
            options.logger || null;



        this.metrics =
            options.metrics || null;



        this.tracer =
            options.tracer || null;



        this.config =
        {

            ...DEFAULTS,

            ...options

        };



        this.runtimeMetrics =
        {

            requests:0,

            successes:0,

            degraded:0,

            blocked:0,

            failures:0

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Express Middleware
     * -------------------------------------------------------------------------
     */


    middleware()
    {


        return async(
            req,
            res,
            next
        )=>{


            if(
                !this.config.enabled
            )
            {

                return next();

            }



            const context =
                this.createRequestContext(
                    req
                );



            if(
                this.config.attachContext
            )
            {

                req.resilience =
                    context;

            }



            this.runtimeMetrics
                .requests++;



            this.attachResponseHooks(

                req,

                res,

                context

            );



            next();

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Controller Wrapper
     * -------------------------------------------------------------------------
     */


    controller(
        operation,
        handler
    )
    {


        return async(
            req,
            res,
            next
        )=>{


            const context =
                this.createRequestContext(
                    req
                );



            try {


                const result =
                    await this.orchestrator.execute(

                        operation,

                        context,

                        ()=>handler(

                            req,

                            res

                        )

                    );



                return this.sendResponse(

                    res,

                    result

                );



            } catch(error) {


                this.runtimeMetrics
                    .failures++;



                next(error);

            }

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Service Wrapper
     * -------------------------------------------------------------------------
     */


    service(
        operation,
        handler
    )
    {


        return async(
            context,
            ...args
        )=>{


            return this.orchestrator.execute(

                operation,

                context,

                ()=>handler(

                    context,

                    ...args

                )

            );

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Request Context Builder
     * -------------------------------------------------------------------------
     */


    createRequestContext(
        req
    )
    {


        return {


            requestId:

                req.id ||
                crypto.randomUUID(),



            correlationId:

                req.headers[
                    'x-correlation-id'
                ]
                ||
                crypto.randomUUID(),



            tenant:

                req.tenant ||
                null,



            user:

                req.user ||
                null,



            operation:

                this.resolveOperation(
                    req
                ),



            method:

                req.method,



            path:

                req.originalUrl,



            timestamp:

                Date.now()

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Operation Resolver
     * -------------------------------------------------------------------------
     */


    resolveOperation(
        req
    )
    {


        return (

            req.route?.path

            ||

            `${req.method}:${req.originalUrl}`

        )

        .replace(

            /\//g,

            '_'

        )

        .toUpperCase();

    }





    /**
     * -------------------------------------------------------------------------
     * Response Hooks
     * -------------------------------------------------------------------------
     */


    attachResponseHooks(
        req,
        res,
        context
    )
    {


        const original =
            res.json;



        res.json =
            (payload)=>{


                this.emit(

                    'response.completed',

                    {

                        operation:
                            context.operation,


                        status:
                            res.statusCode

                    }

                );



                return original.call(

                    res,

                    this.transformResponse(

                        payload

                    )

                );

            };
    }





    /**
     * -------------------------------------------------------------------------
     * Response Transformation
     * -------------------------------------------------------------------------
     */


    transformResponse(
        payload
    )
    {


        if(
            !this.config.captureResponse
        )
        {

            return payload;

        }



        if(
            payload?.fallback
        )
        {

            this.runtimeMetrics
                .degraded++;


            return {

                ...payload,


                resilience:

                {

                    status:

                        RESILIENCE_STATUS.DEGRADED

                }

            };
        }



        return payload;

    }





    /**
     * -------------------------------------------------------------------------
     * Error Handler Middleware
     * -------------------------------------------------------------------------
     */


    errorHandler()
    {


        return async(
            error,
            req,
            res,
            next
        )=>{


            this.emit(

                'error',

                {

                    error,

                    requestId:

                        req.id

                }

            );



            if(
                res.headersSent
            )
            {

                return next(error);

            }



            return res.status(

                503

            )

            .json({

                status:

                    RESILIENCE_STATUS.FAILED,


                error:

                    this.config
                        .exposeDiagnostics

                    ?

                    error.message

                    :

                    'Service temporarily unavailable'

            });

        };
    }





    /**
     * -------------------------------------------------------------------------
     * Health
     * -------------------------------------------------------------------------
     */


    health()
    {

        return {


            active:

                this.config.enabled,


            metrics:

                {

                    ...this.runtimeMetrics

                }

        };
    }





    async shutdown()
    {

        this.removeAllListeners();

    }

}





/**
 * =============================================================================
 * Factory
 * =============================================================================
 */


function createResilienceMiddleware(
    options
)
{


    return new ResilienceMiddleware(
        options
    );

}



module.exports =
{

    ResilienceMiddleware,

    createResilienceMiddleware,

    RESILIENCE_STATUS

};