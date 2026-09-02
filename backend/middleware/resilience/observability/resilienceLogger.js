'use strict';


class ResilienceLogger {


    constructor(
        logger
    )
    {

        this.logger =
            logger;

    }



    event(
        name,
        payload
    )
    {


        this.logger?.info({

            subsystem:

                'RESILIENCE',

            event:

                name,


            timestamp:

                new Date().toISOString(),


            ...payload

        });

    }



}



module.exports =
    ResilienceLogger;