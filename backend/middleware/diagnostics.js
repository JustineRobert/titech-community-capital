"use strict";

/**
 * TITech Community Capital LTD
 * Enterprise Middleware Diagnostics Engine
 *
 * Provides:
 *
 * - Middleware inventory
 * - Runtime diagnostics
 * - Health reporting
 * - Startup verification
 * - Dependency inspection
 * - Failure visibility
 * - Operational metadata
 *
 */



class MiddlewareDiagnostics {



    constructor({

        registry = null,

        pipeline = null,

        lifecycle = null,

        runtimeContext = null,

        serviceRegistry = null,

        metadata = null,

        logger = null

    } = {}) {



        this.registry =
            registry;



        this.pipeline =
            pipeline;



        this.lifecycle =
            lifecycle;



        this.runtimeContext =
            runtimeContext;



        this.serviceRegistry =
            serviceRegistry;



        this.metadata =
            metadata;



        this.logger =
            logger;



        this.createdAt =
            new Date();


    }







    /**
     * Complete diagnostics report
     */
    report() {



        return {


            generatedAt:
                new Date(),



            system:
                this.system(),



            middleware:
                this.middleware(),



            pipeline:
                this.pipelineStatus(),



            lifecycle:
                this.lifecycleStatus(),



            dependencies:
                this.dependencies(),



            health:
                this.health(),



            failures:
                this.failures()



        };


    }








    /**
     * System information
     */
    system() {


        return {


            environment:
                this.runtimeContext
                ?.environment
                ||
                process.env.NODE_ENV,



            version:
                this.runtimeContext
                ?.version
                ||
                this.metadata
                ?.version,



            service:
                this.metadata
                ?.serviceName
                ||
                null,



            hostname:
                process.hostname,



            node:
                process.version,



            platform:
                process.platform,



            uptime:
                process.uptime(),



            generatedAt:
                new Date()


        };


    }








    /**
     * Middleware inventory
     */
    middleware() {



        if(
            !this.registry
        ){

            return {

                count:0,

                items:[]

            };

        }




        const items =
            this.registry
            .list()
            .map(

                middleware => ({

                    name:
                        middleware.name,


                    version:
                        middleware.version,


                    phase:
                        middleware.phase,


                    priority:
                        middleware.priority,


                    enabled:
                        middleware.enabled,


                    critical:
                        middleware.critical,


                    status:
                        middleware.status,


                    dependencies:
                        middleware.dependencies


                })

            );



        return {


            count:
                items.length,


            items



        };


    }








    /**
     * Pipeline information
     */
    pipelineStatus() {



        if(
            !this.pipeline
        ){

            return null;

        }



        return {


            installed:
                this.pipeline.installed
                ||
                [],



            failed:
                this.pipeline.failed
                ||
                [],



            history:

                this.pipeline.executionHistory
                ||
                []


        };


    }








    /**
     * Lifecycle information
     */
    lifecycleStatus() {



        if(
            !this.lifecycle
        ){

            return null;

        }



        return this.lifecycle.diagnostics();



    }








    /**
     * Dependency diagnostics
     */
    dependencies() {



        if(
            !this.registry
        ){

            return {};

        }



        return {


            graph:

                this.registry
                .dependencyGraph
                ?


                this.registry
                .dependencyGraph()


                :

                {},




            services:

                this.serviceRegistry
                ?.diagnostics
                ?


                this.serviceRegistry
                    .diagnostics()


                :

                null



        };


    }








    /**
     * Health aggregation
     */
    health() {



        const lifecycleHealthy =

            this.lifecycle
            ?

            this.lifecycle
                .health()
                .healthy

            :

            true;



        const registryHealthy =

            this.registry
            ?

            this.registry
                .health()
                .healthy

            :

            true;





        const pipelineHealthy =

            !this.pipeline
            ||

            (
                this.pipeline.failed.length === 0
            );






        return {


            healthy:

                lifecycleHealthy &&

                registryHealthy &&

                pipelineHealthy,



            lifecycle:

                this.lifecycle
                ?.health(),



            registry:

                this.registry
                ?.health(),



            pipeline:

                {

                    healthy:
                        pipelineHealthy

                }



        };


    }








    /**
     * Failure report
     */
    failures() {



        return {


            lifecycle:

                this.lifecycle
                ?.errors
                ||
                [],



            pipeline:

                this.pipeline
                ?.failed
                ||
                [],



            total:

                (

                    this.lifecycle
                    ?.errors
                    ?.length
                    ||
                    0

                )

                +

                (

                    this.pipeline
                    ?.failed
                    ?.length
                    ||
                    0

                )



        };


    }








    /**
     * Readiness check
     */
    readiness() {


        const health =
            this.health();



        return {


            ready:
                health.healthy,


            timestamp:
                new Date(),


            health



        };


    }








    /**
     * Liveness check
     */
    liveness() {



        return {


            alive:true,


            timestamp:
                new Date(),


            uptime:
                process.uptime()



        };


    }








    /**
     * Lightweight summary
     */
    summary() {


        const report =
            this.report();



        return {


            environment:
                report.system.environment,


            middlewareCount:
                report.middleware.count,


            lifecycle:
                report.lifecycle?.state,


            healthy:
                report.health.healthy,


            failures:
                report.failures.total



        };


    }







    /**
     * Safe export
     */
    toJSON() {


        return this.report();


    }



}








/**
 * Factory helper
 */
function createDiagnostics(options){


    return new MiddlewareDiagnostics(
        options
    );


}







/**
 * Backward-compatible helper
 */
function generateDiagnostics({

    registry,

    runtimeContext,

    pipeline,

    lifecycle,

    serviceRegistry,

    metadata

} = {}) {



    const diagnostics =
        new MiddlewareDiagnostics({

            registry,

            runtimeContext,

            pipeline,

            lifecycle,

            serviceRegistry,

            metadata

        });



    return diagnostics.report();


}





module.exports = {


    MiddlewareDiagnostics,


    createDiagnostics,


    generateDiagnostics


};