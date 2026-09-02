'use strict';


class AIDecisionAudit {


    constructor()
    {

        this.records=[];

    }



    record(
        decision
    )
    {


        this.records.push({

            ...decision,


            timestamp:

                new Date()

        });

    }



    history()
    {

        return [

            ...this.records

        ];

    }



}



module.exports =
    AIDecisionAudit;