'use strict';


class ContinuousOptimizationEngine {


    optimize(
        metrics,
        configuration
    )
    {


        if(
            metrics.failureRate > 0.5
        )
        {

            return {


                ...configuration,


                aggressiveRecovery:

                    true

            };

        }



        return configuration;

    }



}



module.exports =
    ContinuousOptimizationEngine;