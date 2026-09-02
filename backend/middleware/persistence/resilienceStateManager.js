'use strict';


class ResilienceStateManager {


    constructor(
        stores
    )
    {

        this.stores =
            stores;

    }




    async persistCircuit(
        circuit
    )
    {


        return this.stores
            .circuit
            .save(

                circuit

            );

    }





    async restoreCircuit(
        name
    )
    {


        return this.stores
            .circuit
            .restore(

                name

            );

    }



}



module.exports =
    ResilienceStateManager;