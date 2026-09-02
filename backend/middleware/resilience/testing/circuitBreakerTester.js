'use strict';


class CircuitBreakerTester {


    constructor(
        circuit
    )
    {

        this.circuit =
            circuit;

    }




    async openCircuit()
    {


        for(
            let i=0;
            i < this.circuit.options.failureThreshold;
            i++
        )
        {


            try {


                await this.circuit.execute(

                    async()=>{

                        throw new Error(
                            'Injected failure'
                        );

                    }

                );


            }
            catch(error){}

        }



        return this.circuit.snapshot();

    }




    verifyOpen()
    {

        return (

            this.circuit.state === 'OPEN'

        );

    }



}



module.exports =
    CircuitBreakerTester;