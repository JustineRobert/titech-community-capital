'use strict';


const ResilienceStateManager =
require(
'../../persistence/resilienceStateManager.js'
);


const ResilienceCircuitStateStore =
require(
'../../persistence/resilienceCircuitStateStore.js'
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