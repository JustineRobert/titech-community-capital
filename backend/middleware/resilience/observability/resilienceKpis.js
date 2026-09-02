'use strict';


class ResilienceKpis {


    calculate(
        snapshot
    )
    {


        const total =
            snapshot.executions || 1;



        return {


            availability:

                (

                    snapshot.successes /
                    total

                )

                *

                100,



            degradationRate:

                (

                    snapshot.degraded /
                    total

                )

                *

                100,



            failureRate:

                (

                    snapshot.failures /
                    total

                )

                *

                100

        };

    }


}



module.exports =
    ResilienceKpis;