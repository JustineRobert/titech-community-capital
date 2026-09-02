'use strict';


class ResilienceTelemetryCollector {


    constructor()
    {

        this.samples = [];

    }



    record(
        metric
    )
    {


        this.samples.push({

            ...metric,

            timestamp:

                Date.now()

        });


    }



    latest()
    {

        return this.samples.at(-1);

    }



    history()
    {

        return [

            ...this.samples

        ];

    }



}



module.exports =
    ResilienceTelemetryCollector;