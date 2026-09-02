'use strict';


const ResilienceMessageBroker =
require('./resilienceMessageBroker');



class RabbitMqResilienceAdapter
extends ResilienceMessageBroker {


    constructor(
        channel
    )
    {

        super();


        this.channel =
            channel;

    }



    async publish(
        queue,
        event
    )
    {


        return this.channel?.sendToQueue(

            queue,

            Buffer.from(

                JSON.stringify(event)

            )

        );

    }



}



module.exports =
    RabbitMqResilienceAdapter;