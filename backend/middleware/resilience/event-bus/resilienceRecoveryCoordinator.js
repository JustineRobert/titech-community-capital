'use strict';


const EVENTS =
require('./resilienceEventTypes');



class ResilienceRecoveryCoordinator {


    constructor(
        bus,
        orchestrator
    )
    {

        this.bus =
            bus;


        this.orchestrator =
            orchestrator;


        this.register();

    }





    register()
    {


        this.bus.subscribe(

            EVENTS.FAILURE_DETECTED,

            async(event)=>{


                await this.startRecovery(

                    event

                );


            }

        );

    }





    async startRecovery(
        event
    )
    {


        this.bus.publish({

            type:

                EVENTS.RECOVERY_STARTED,


            payload:

                event

        });



        try {


            const result =
                await this.orchestrator.recover(

                    event

                );



            this.bus.publish({

                type:

                    EVENTS.RECOVERY_COMPLETED,


                payload:

                    result

            });



        }
        catch(error)
        {


            this.bus.publish({

                type:

                    EVENTS.RECOVERY_FAILED,


                payload:

                    {

                        error:
                            error.message

                    }

            });


        }

    }



}



module.exports =
    ResilienceRecoveryCoordinator;