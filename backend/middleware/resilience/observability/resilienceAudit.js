'use strict';


class ResilienceAudit {


    constructor(
        repository
    )
    {

        this.repository =
            repository;

    }



    async record(
        decision
    )
    {


        return this.repository?.create({

            type:

                'RESILIENCE_DECISION',


            ...decision,


            timestamp:

                new Date()

        });

    }


}



module.exports =
    ResilienceAudit;