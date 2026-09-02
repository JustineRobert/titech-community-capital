'use strict';


const EventEmitter =
require('events');



class ResilienceEventBus extends EventEmitter {


    constructor()
    {

        super();


        this.history = [];

    }



    publish(
        event
    )
    {


        this.history.push(event);



        this.emit(

            event.type,

            event

        );



        this.emit(

            '*',

            event

        );



        return event;

    }





    subscribe(
        type,
        handler
    )
    {


        this.on(

            type,

            handler

        );

    }





    getHistory()
    {

        return [

            ...this.history

        ];

    }



}



module.exports =
    ResilienceEventBus;