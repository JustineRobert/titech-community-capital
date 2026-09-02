'use strict';


class AutonomousResilienceAgent {


    constructor(
        aiEngine
    )
    {

        this.engine =
            aiEngine;

    }



    async operate(
        telemetry
    )
    {


        const intelligence =
            await this.engine.analyze(

                telemetry

            );



        if(
            intelligence.prediction.risk ===
            'HIGH'
        )
        {


            return {


                autonomousAction:

                    'START_PREVENTIVE_RECOVERY',


                intelligence

            };


        }



        return {


            autonomousAction:

                'MONITOR',


            intelligence

        };


    }



}



module.exports =
    AutonomousResilienceAgent;