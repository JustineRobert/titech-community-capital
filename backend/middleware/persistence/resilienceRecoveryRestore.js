'use strict';


class ResilienceRecoveryRestore {


    constructor(
        stateManager
    )
    {

        this.stateManager =
            stateManager;

    }




    async restore()
    {


        return {

            restored:

                true,


            timestamp:

                new Date()

        };

    }



}



module.exports =
    ResilienceRecoveryRestore;