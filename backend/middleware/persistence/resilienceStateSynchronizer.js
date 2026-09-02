'use strict';


const EventEmitter =
require('events');



class ResilienceStateSynchronizer
extends EventEmitter {


    constructor(
        eventBus
    )
    {

        super();


        this.eventBus =
            eventBus;

    }



    publish(
        state
    )
    {


        this.eventBus.publish({

            type:

                'RESILIENCE.STATE.SYNC',


            payload:

                state

        });

    }



}



module.exports =
    ResilienceStateSynchronizer;