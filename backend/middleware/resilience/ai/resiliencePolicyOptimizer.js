'use strict';


class ResiliencePolicyOptimizer {


    optimize(
        metrics,
        policy
    )
    {


        if(
            metrics.failureRate > 0.7
        )
        {


            return {

                ...policy,


                failureThreshold:

                    Math.max(

                        2,

                        policy.failureThreshold - 1

                    )

            };

        }



        return policy;

    }



}



module.exports =
    ResiliencePolicyOptimizer;