'use strict';


const EventEmitter =
require(
    'events'
);



class ResilienceRuntime extends EventEmitter {


    constructor(options={})
    {

        super();


        this.container =
            options.container;


        this.config =
            options.config || {};



        this.state =
        {

            status:
                'CREATED',

            startedAt:
                null

        };

    }



    async initialize()
    {


        this.state.status =
            'INITIALIZING';



        this.registerRuntimeServices();



        this.state.status =
            'READY';



        this.state.startedAt =
            Date.now();



        this.emit(

            'ready'

        );

    }





    registerRuntimeServices()
    {


        this.container.singleton(

            'resilienceRuntime',

            ()=>this

        );


    }



    health()
    {

        return {

            status:

                this.state.status,


            startedAt:

                this.state.startedAt

        };

    }



    async shutdown()
    {


        this.state.status =
            'SHUTTING_DOWN';



        this.container.shutdown();



        this.state.status =
            'STOPPED';



        this.emit(

            'shutdown'

        );

    }

}



module.exports =
    ResilienceRuntime;