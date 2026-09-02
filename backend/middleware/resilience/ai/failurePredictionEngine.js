'use strict';


class FailurePredictionEngine {


    constructor(
        model=null
    )
    {

        this.model =
            model;

    }




    async predict(
        telemetry
    )
    {


        /*
         *
         * Production implementation:
         *
         * TensorFlow
         * PyTorch service
         * ML microservice
         *
         */


        const failureProbability =

            telemetry.errorRate > 0.5

                ? 0.85

                : 0.15;



        return {


            dependency:

                telemetry.dependency,


            probability:

                failureProbability,



            risk:

                failureProbability > 0.7

                    ? 'HIGH'

                    : 'LOW'

        };


    }



}



module.exports =
    FailurePredictionEngine;