'use strict';


class ResilienceThreatDetector {


    constructor()
    {

        this.events=[];

    }



    detect(
        event
    )
    {


        const suspicious =

            event.action ===
            'FORCE_OPEN_CIRCUIT'
            &&
            event.actorRole !==
            'ADMIN';



        if(
            suspicious
        )
        {

            this.events.push(event);


            return {

                threat:true,

                event

            };

        }



        return {

            threat:false

        };

    }



}



module.exports =
    ResilienceThreatDetector;