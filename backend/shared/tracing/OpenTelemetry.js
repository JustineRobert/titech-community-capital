'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/tracing/OpenTelemetry.js
 *
 * Enterprise Distributed Tracing Foundation
 *
 * Responsibilities:
 *
 * - Initialize OpenTelemetry tracing
 * - Create and manage spans
 * - Propagate trace context
 * - Correlate requests and services
 * - Support distributed tracing
 * - Support service-to-service visibility
 *
 *
 * Trace Flow:
 *
 * HTTP Request
 *      |
 *      v
 * API Gateway
 *      |
 *      v
 * Express Controller
 *      |
 *      v
 * Service Layer
 *      |
 *      v
 * Database
 *
 *
 * Example:
 *
 * Loan Application
 *
 * traceId:
 * 8d7f8e9a....
 *
 * spans:
 *
 * HTTP POST /loan
 *      |
 *      +-- LoanService.create()
 *              |
 *              +-- MongoDB insert()
 *
 *
 * =============================================================================
 */


const os =
    require('os');



const DEFAULT_SERVICE_NAME =
    'titech-community-capital';





/**
 * Runtime tracing state.
 */
const tracingState = {


    initialized:
        false,


    tracer:
        null,


    provider:
        null,


    exporter:
        null

};







/**
 * OpenTelemetry wrapper.
 *
 * This intentionally avoids
 * forcing a backend exporter.
 *
 * Install adapters later:
 *
 * - OTLP
 * - Jaeger
 * - Tempo
 */
class OpenTelemetry {


    constructor({

        serviceName =
            DEFAULT_SERVICE_NAME,


        environment =
            process.env.NODE_ENV ||
            'development'


    } = {}) {


        this.serviceName =
            serviceName;



        this.environment =
            environment;



        Object.freeze(this);

    }









    /**
     * Initialize tracing.
     */
    initialize({

        exporter = null

    } = {}) {



        if (
            tracingState.initialized
        ) {


            return this;

        }





        /**
         * Placeholder abstraction.
         *
         * Real OpenTelemetry SDK
         * can attach here.
         */
        tracingState.provider = {


            serviceName:
                this.serviceName,


            environment:
                this.environment,


            hostname:
                os.hostname()

        };




        tracingState.exporter =
            exporter;




        tracingState.tracer =
            {


                startSpan:

                    (

                        name,

                        attributes = {}

                    ) => {


                        return this.createSpan(

                            name,

                            attributes

                        );


                    }


            };





        tracingState.initialized =
            true;



        return this;

    }









    /**
     * Retrieve tracer.
     */
    getTracer() {


        if (
            !tracingState.initialized
        ) {


            this.initialize();

        }



        return tracingState.tracer;

    }









    /**
     * Create application span.
     */
    createSpan(

        name,

        attributes = {}

    ) {


        const startTime =
            Date.now();



        const span = {


            name,


            traceId:
                generateId(),



            spanId:
                generateId(),



            startTime,



            attributes:
                {


                    service:
                        this.serviceName,


                    environment:
                        this.environment,


                    hostname:
                        os.hostname(),



                    ...sanitizeAttributes(
                        attributes
                    )


                },



            events:
                []



        };






        return {


            traceId:
                span.traceId,


            spanId:
                span.spanId,



            setAttribute:

                (

                    key,

                    value

                ) => {


                    span.attributes[key] =
                        value;


                },



            addEvent:

                (

                    event,

                    metadata = {}

                ) => {


                    span.events.push({

                        event,

                        metadata,

                        timestamp:
                            Date.now()

                    });


                },



            end:

                () => {


                    span.duration =
                        Date.now() -
                        startTime;



                    this.exportSpan(
                        span
                    );



                    return span;


                }



        };


    }









    /**
     * Express request tracing helper.
     */
    traceRequest(req) {


        return this.createSpan(

            `${req.method} ${req.path}`,

            {


                requestId:
                    req.id,


                correlationId:
                    req.context
                    ?.correlationId,


                tenant:
                    req.context
                    ?.tenant?.id,


                user:
                    req.context
                    ?.user?.id


            }

        );


    }









    /**
     * Service tracing helper.
     */
    traceService(

        service,

        operation,

        metadata = {}

    ) {


        return this.createSpan(

            `${service}.${operation}`,

            metadata

        );


    }









    /**
     * Database tracing helper.
     */
    traceDatabase(

        operation,

        metadata = {}

    ) {


        return this.createSpan(

            `database.${operation}`,

            metadata

        );


    }









    /**
     * Export completed span.
     */
    exportSpan(span) {



        if (
            tracingState.exporter &&
            typeof tracingState.exporter.export === 'function'
        ) {


            tracingState.exporter.export(
                span
            );


        }


    }

}


/**
 * Generate trace identifiers.
 */
function generateId() {


    return (

        Math.random()
            .toString(16)
            .substring(2)
        +

        Date.now()
            .toString(16)

    );


}


/**
 * Remove unsafe attributes.
 */
function sanitizeAttributes(attributes) {


    const output = {};



    Object.entries(attributes)

        .forEach(

            ([key,value]) => {


                if (

                    value === undefined ||
                    value === null

                ) {


                    return;

                }



                output[key] =
                    String(value);


            }

        );



    return output;

}


module.exports =
    OpenTelemetry;