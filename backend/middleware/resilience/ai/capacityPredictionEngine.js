'use strict';


class CapacityPredictionEngine {


    predict(
        usage
    )
    {


        return {


            expectedLoad:

                usage.current * 1.25,


            scalingRequired:

                usage.current >
                usage.limit * 0.8

        };


    }



}



module.exports =
    CapacityPredictionEngine;