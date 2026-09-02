'use strict';


class ResilienceCircuitStateStore {


    constructor(
        repository
    )
    {

        this.repository =
            repository;

    }



    async save(
        circuit
    )
    {


        return this.repository.save({

            type:

                'CIRCUIT_STATE',


            name:

                circuit.name,


            state:

                circuit.state,


            nextAttempt:

                circuit.nextAttempt,


            metrics:

                circuit.metrics,


            updatedAt:

                new Date()

        });

    }





    async restore(
        name
    )
    {


        return this.repository.findOne({

            type:

                'CIRCUIT_STATE',


            name

        });

    }



}



module.exports =
    ResilienceCircuitStateStore;