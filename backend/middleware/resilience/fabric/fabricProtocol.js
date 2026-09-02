"use strict";


const PROTOCOL_VERSION =
    "1.0.0";


const MESSAGE_STATE = Object.freeze({

    CREATED:
        "CREATED",

    VALID:
        "VALID",

    INVALID:
        "INVALID"

});



function createId(prefix) {

    return (

        `${prefix}_${crypto.randomUUID()}`

    );

}



class FabricProtocol {


    constructor(options = {}) {


        this.version =
            options.version ||
            PROTOCOL_VERSION;


        this.clock =
            options.clock ||

            (() => new Date());



        this.contracts =
            new Map();



        this.metrics =
            {

                messagesCreated:
                    0,

                validations:
                    0

            };

    }



    createEnvelope(options = {}) {


        const envelope =
            Object.freeze({

                id:
                    createId(
                        "message"
                    ),


                version:
                    this.version,


                source:
                    options.source,


                target:
                    options.target,


                capability:
                    options.capability,


                payload:
                    options.payload || {},


                state:
                    MESSAGE_STATE.CREATED,


                createdAt:
                    this.clock()

            });



        this.metrics.messagesCreated++;



        return envelope;

    }



    validateCompatibility(
        envelope
    ) {


        this.metrics.validations++;


        return Object.freeze({

            compatible:

                envelope.version ===
                this.version,


            version:

                envelope.version,


            expected:

                this.version,


            checkedAt:
                this.clock()

        });

    }



    registerContract(
        capability,
        contract
    ) {


        this.contracts.set(

            capability,

            Object.freeze(
                contract
            )

        );


        return this.contracts.get(
            capability
        );

    }



    negotiateCapability(
        capability,
        version
    ) {


        const contract =
            this.contracts.get(
                capability
            );



        return Object.freeze({

            capability,


            supported:

                Boolean(contract),


            version,


            negotiatedAt:
                this.clock()

        });

    }



}



module.exports =
    FabricProtocol;