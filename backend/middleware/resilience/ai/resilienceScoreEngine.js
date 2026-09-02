'use strict';


class ResilienceScoreEngine {


    calculate(
        telemetry
    )
    {


        const score =

            100 -

            (

                telemetry.errorRate * 50 +

                telemetry.latencyRate * 50

            );



        return {


            score:

                Math.max(

                    0,

                    score

                ),


            grade:

                score > 80

                    ? 'A'

                    : score > 60

                    ? 'B'

                    : 'C'


        };


    }



}



module.exports =
    ResilienceScoreEngine;