'use strict';


const ResilienceMessageBroker =
require('./resilienceMessageBroker');



class KafkaResilienceAdapter
extends ResilienceMessageBroker {


    constructor(
        kafka
    )
    {

        super();

        this.kafka =
            kafka;

    }



    async publish(
        topic,
        event
    )
    {


        return this.kafka?.send({

            topic,

            messages:[

                {

                    value:

                        JSON.stringify(event)

                }

            ]

        });

    }



}



module.exports =
    KafkaResilienceAdapter;