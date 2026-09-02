'use strict';


const EventEmitter =
require('events');



class ResilienceEventStream extends EventEmitter {


    publish(
        event,
        payload
    )
    {


        this.emit(

            event,

            {

                timestamp:
                    Date.now(),

                ...payload

            }

        );

    }



}



module.exports =
    ResilienceEventStream;