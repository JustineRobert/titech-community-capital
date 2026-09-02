'use strict';


class ResilienceDashboardController {


    constructor(
        telemetry,
        policyEngine
    )
    {

        this.telemetry =
            telemetry;


        this.policyEngine =
            policyEngine;

    }



    overview(
        req,
        res
    )
    {

        res.json({

            resilience:

                this.telemetry.snapshot(),


            policies:

                this.policyEngine.snapshot()

        });

    }


}



module.exports =
    ResilienceDashboardController;