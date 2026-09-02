'use strict';


const ResilienceTelemetry =
require('./resilienceTelemetry');


const ResilienceMetrics =
require('./resilienceMetrics');


const ResilienceTracer =
require('./resilienceTracer');


const ResilienceLogger =
require('./resilienceLogger');


const ResilienceEventStream =
require('./resilienceEventStream');


const ResilienceHealthTelemetry =
require('./resilienceHealthTelemetry');




function bootstrapResilienceObservability(
    options={}
)
{


    return {


        telemetry:

            new ResilienceTelemetry(options),



        metrics:

            new ResilienceMetrics(

                options.prometheus

            ),



        tracer:

            new ResilienceTracer(

                options.tracer

            ),



        logger:

            new ResilienceLogger(

                options.logger

            ),



        events:

            new ResilienceEventStream(),



        health:

            new ResilienceHealthTelemetry()

    };

}



module.exports =
{

    bootstrapResilienceObservability

};