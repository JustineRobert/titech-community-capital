'use strict';


class ResilienceCircuitConfig {


    constructor(registry)
    {

        this.registry =
            registry;

    }



    updateCircuit(
        name,
        options
    )
    {


        const circuit =
            this.registry.get(
                name
            );


        if(!circuit)
        {

            throw new Error(

                `Circuit not found ${name}`

            );

        }



        Object.assign(

            circuit.options,

            options

        );


        return circuit.snapshot();

    }



}



module.exports =
    ResilienceCircuitConfig;