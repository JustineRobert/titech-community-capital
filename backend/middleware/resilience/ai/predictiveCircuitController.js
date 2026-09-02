'use strict';


class PredictiveCircuitController {


    constructor(
        circuitRegistry
    )
    {

        this.registry =
            circuitRegistry;

    }



    evaluate(
        prediction
    )
    {


        if(
            prediction.probability >= 0.9
        )
        {


            const circuit =
                this.registry.get(

                    prediction.dependency

                );



            if(circuit)
            {

                circuit.forceOpen();

            }


            return {

                action:

                    'CIRCUIT_PREVENTIVELY_OPENED'

            };

        }



        return {

            action:

                'NO_ACTION'

        };


    }



}



module.exports =
    PredictiveCircuitController;