'use strict';


class ResilienceMessageBroker {


    async publish(
        topic,
        event
    )
    {

        throw new Error(

            'publish() not implemented'

        );

    }



    async subscribe(
        topic,
        handler
    )
    {

        throw new Error(

            'subscribe() not implemented'

        );

    }



}



module.exports =
    ResilienceMessageBroker;