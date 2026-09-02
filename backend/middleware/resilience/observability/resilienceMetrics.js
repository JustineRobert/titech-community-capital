'use strict';


class ResilienceMetrics {


    constructor(prometheus)
    {


        this.prometheus =
            prometheus;



        this.metrics =
        {

            executions:
                this.createCounter(
                    'resilience_executions_total'
                ),


            failures:
                this.createCounter(
                    'resilience_failures_total'
                ),


            degraded:
                this.createCounter(
                    'resilience_degraded_total'
                ),


            latency:
                this.createHistogram(
                    'resilience_latency_seconds'
                )

        };

    }



    createCounter(
        name
    )
    {

        if(!this.prometheus)
            return null;


        return new this.prometheus.Counter({

            name,

            help:
                name

        });

    }



    createHistogram(
        name
    )
    {

        if(!this.prometheus)
            return null;


        return new this.prometheus.Histogram({

            name,

            help:
                name

        });

    }



    increment(
        metric
    )
    {


        this.metrics[metric]?.inc();

    }


}



module.exports =
    ResilienceMetrics;