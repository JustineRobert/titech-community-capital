'use strict';


const crypto =
require('crypto');



class ResilienceAuditProtection {


    constructor()
    {

        this.previousHash =
            null;

    }



    protect(
        event
    )
    {


        const payload =
            JSON.stringify({

                previousHash:

                    this.previousHash,


                event

            });



        const hash =
            crypto
            .createHash('sha256')
            .update(payload)
            .digest('hex');



        this.previousHash =
            hash;



        return {

            ...event,

            hash,

            previousHash:

                this.previousHash

        };

    }



}



module.exports =
    ResilienceAuditProtection;