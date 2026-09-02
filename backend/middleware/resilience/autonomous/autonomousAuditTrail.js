'use strict';


class AutonomousAuditTrail {


    constructor()
    {

        this.events=[];

    }



    record(
        event
    )
    {

        this.events.push({

            ...event,


            timestamp:

                new Date()

        });

    }



    history()
    {

        return this.events;

    }



}



module.exports =
    AutonomousAuditTrail;