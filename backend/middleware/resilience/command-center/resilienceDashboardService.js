'use strict';


class ResilienceDashboardService {


    constructor(
        runtime
    )
    {

        this.runtime =
            runtime;

    }



    async summary()
    {


        return {


            circuits:

                this.runtime.circuits.snapshot(),


            health:

                this.runtime.health(),


            timestamp:

                new Date()


        };

    }



}



module.exports =
    ResilienceDashboardService;