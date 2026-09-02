'use strict';


class ResilienceCircuitAdmin {


    constructor(
        circuitConfig
    )
    {

        this.circuitConfig =
            circuitConfig;

    }



    update(
        name,
        configuration
    )
    {

        return this.circuitConfig
            .updateCircuit(

                name,

                configuration

            );

    }



    forceOpen(
        circuit
    )
    {

        return circuit.forceOpen();

    }



    forceClose(
        circuit
    )
    {

        return circuit.forceClose();

    }



}



module.exports =
    ResilienceCircuitAdmin;