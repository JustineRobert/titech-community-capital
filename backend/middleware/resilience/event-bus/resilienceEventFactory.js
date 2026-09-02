'use strict';


const crypto =
require('crypto');



class ResilienceEventFactory {


    create(
        type,
        payload={}
    )
    {


        return Object.freeze({

            id:

                crypto.randomUUID(),


            type,


            timestamp:

                new Date(),


            correlationId:

                payload.correlationId || null,


            tenantId:

                payload.tenantId || null,


            payload

        });

    }


}



module.exports =
    ResilienceEventFactory;