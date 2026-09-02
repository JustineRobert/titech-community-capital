"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Bootstrap & Service Registration Layer
 * =============================================================================
 *
 * Central lifecycle manager for Enterprise Retry Infrastructure.
 *
 * Responsibilities:
 *
 * ✓ Initialize retry subsystem
 * ✓ Dependency injection
 * ✓ Register policies
 * ✓ Register middleware
 * ✓ Register metrics
 * ✓ Register tracing
 * ✓ Register events
 * ✓ Health checks
 * ✓ Readiness checks
 * ✓ Shutdown hooks
 * ✓ Configuration loading
 * ✓ Enterprise exports
 *
 * Integrates with:
 *
 * - backend/app.js
 * - Runtime Context
 * - Service Registry
 * - Structured Logger
 * - OpenTelemetry
 * - Metrics
 *
 * =============================================================================
 */



const EventEmitter = require("events");



const {
    retryPolicyRegistry
} = require("./retryPolicyRegistry");



const {
    retryMiddleware
} = require("./retryMiddleware");



const {
    retryExecutionEngine
} = require("./retryExecutionEngine");



const {
    retryObservability
} = require("./retryObservability");



const {
    retryContextManager
} = require("./retryContextManager");





/* =============================================================================
 * Retry Service Error
 * =============================================================================
 */


class RetryServiceError extends Error {


    constructor(
        message,
        options={}
    ) {

        super(message);


        this.name =
            "RetryServiceError";


        this.code =
            "RETRY_SERVICE_ERROR";


        this.cause =
            options.cause;


    }

}




/* =============================================================================
 * Enterprise Retry Service
 * =============================================================================
 */


class RetryService {



    constructor(options={}) {


        this.name =
            options.name
            ||
            "enterprise-retry-service";



        this.config =
            options.config
            ||
            {};



        this.logger =
            options.logger
            ||
            console;



        this.metrics =
            options.metrics
            ||
            null;



        this.tracer =
            options.tracer
            ||
            null;



        this.events =
            options.events
            ||
            new EventEmitter();



        this.serviceRegistry =
            options.serviceRegistry
            ||
            null;



        this.initialized =
            false;



        this.shuttingDown =
            false;



        this.dependencies =
            {};


    }





    /* =========================================================================
     * Initialize
     * =========================================================================
     */


    async initialize(
        dependencies={}
    ) {


        if (
            this.initialized
        ) {

            return this;

        }



        this.dependencies =
            dependencies;



        this.loadConfiguration();



        this.registerPolicies();



        this.registerMetrics();



        this.registerTracing();



        this.registerEvents();



        this.registerMiddleware();



        this.registerServices();



        this.initialized =
            true;



        this.logger.info(

            "Enterprise Retry Service initialized",

            {

                policies:
                    retryPolicyRegistry.listPolicies()

            }

        );



        return this;


    }





    /* =========================================================================
     * Configuration
     * =========================================================================
     */


    loadConfiguration()
    {


        this.config = {


            enabled:
                this.config.enabled !== false,


            defaultPolicy:
                this.config.defaultPolicy
                ||
                "externalApiPolicy",


            observability:
                {

                    enabled:
                        true

                },


            ...this.config


        };


    }





    /* =========================================================================
     * Policy Registration
     * =========================================================================
     */


    registerPolicies()
    {


        if (
            this.config.freezePolicies
        ) {


            retryPolicyRegistry.freezeRegistry();


        }


    }





    /* =========================================================================
     * Middleware Registration
     * =========================================================================
     */


    registerMiddleware()
    {


        this.middleware =
            retryMiddleware;



    }





    /* =========================================================================
     * Metrics Registration
     * =========================================================================
     */


    registerMetrics()
    {


        retryObservability.metrics =
            this.metrics;


    }





    /* =========================================================================
     * Tracing Registration
     * =========================================================================
     */


    registerTracing()
    {


        retryObservability.tracer =
            this.tracer;


    }





    /* =========================================================================
     * Event Registration
     * =========================================================================
     */


    registerEvents()
    {


        retryExecutionEngine.events =
            this.events;


    }





    /* =========================================================================
     * Service Registry Integration
     * =========================================================================
     */


    registerServices()
    {


        if (
            !this.serviceRegistry
        ) {

            return;

        }



        this.serviceRegistry.register(

            "retryService",

            this

        );



        this.serviceRegistry.register(

            "retryPolicyRegistry",

            retryPolicyRegistry

        );



        this.serviceRegistry.register(

            "retryExecutionEngine",

            retryExecutionEngine

        );



        this.serviceRegistry.register(

            "retryMiddleware",

            retryMiddleware

        );


    }





    /* =========================================================================
     * Health Check
     * =========================================================================
     */


    health()
    {


        return {


            service:
                this.name,


            status:

                this.shuttingDown

                ?

                "DOWN"

                :

                "UP",



            initialized:
                this.initialized,


            timestamp:
                new Date()


        };


    }





    /* =========================================================================
     * Readiness Check
     * =========================================================================
     */


    readiness()
    {


        return {


            ready:

                this.initialized
                &&
                !this.shuttingDown,



            dependencies:
                {

                    policies:

                        retryPolicyRegistry
                        .listPolicies()

                }



        };


    }





    /* =========================================================================
     * Shutdown
     * =========================================================================
     */


    async shutdown()
    {


        this.shuttingDown =
            true;



        this.logger.info(

            "Stopping Enterprise Retry Service"

        );



        retryContextManager.shutdown();



        this.events.emit(

            "retry.shutdown"

        );



        return true;


    }




}





/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryService =
    new RetryService();





/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryService(
    options={}
) {

    return new RetryService(
        options
    );

}





module.exports = {


    RetryService,

    RetryServiceError,

    retryService,

    createRetryService

};