'use strict';


const EventEmitter =
require('events');



class ResilienceSecurityEvents
extends EventEmitter {


    publish(
        event
    )
    {

        this.emit(

            'security.event',

            {

                timestamp:

                    Date.now(),


                ...event

            }

        );

    }



}



module.exports =
    ResilienceSecurityEvents;