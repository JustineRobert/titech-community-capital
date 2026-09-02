'use strict';


const ResilienceStateManager =
require(
'./resilienceStateManager'
);


const ResilienceCircuitStateStore =
require(
'./resilienceCircuitStateStore'
);



function bootstrapResiliencePersistence(
    options={}
)
{


    const circuitStore =
        new ResilienceCircuitStateStore(

            options.repository

        );



    const stateManager =
        new ResilienceStateManager({

            circuit:

                circuitStore

        });



    return {


        stateManager,


        restore:

            async()=>{


                return true;

            }


    };

}



module.exports =
{

    bootstrapResiliencePersistence

};