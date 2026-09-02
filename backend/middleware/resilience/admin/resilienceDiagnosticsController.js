'use strict';


class ResilienceDiagnosticsController {


    constructor(
        runtime,
        telemetry
    )
    {

        this.runtime =
            runtime;


        this.telemetry =
            telemetry;

    }



    health(
        req,
        res
    )
    {

        res.json({

            runtime:

                this.runtime.health(),


            telemetry:

                this.telemetry.snapshot()

        });

    }



}



module.exports =
    ResilienceDiagnosticsController;