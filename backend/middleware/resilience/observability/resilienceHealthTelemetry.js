'use strict';


class ResilienceHealthTelemetry {


    constructor()
    {

        this.dependencies =
            new Map();

    }



    update(
        dependency,
        status
    )
    {


        this.dependencies.set(

            dependency,

            {

                status,

                checkedAt:

                    Date.now()

            }

        );

    }



    snapshot()
    {

        return Object.fromEntries(

            this.dependencies

        );

    }



}



module.exports =
    ResilienceHealthTelemetry;