'use strict';


class RecoveryDecisionEngine {


    decide(
        intelligence
    )
    {


        if(
            intelligence.prediction.risk ===
            'HIGH'
        )
        {


            return {


                strategy:

                    'PREVENTIVE_RECOVERY',


                priority:

                    'HIGH'

            };


        }



        return {


            strategy:

                'NORMAL_OPERATION',


            priority:

                'LOW'

        };


    }



}



module.exports =
    RecoveryDecisionEngine;