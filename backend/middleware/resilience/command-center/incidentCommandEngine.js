'use strict';


class IncidentCommandEngine {


    constructor()
    {

        this.incidents=[];

    }



    create(
        incident
    )
    {


        const record =
        {

            id:

                crypto.randomUUID(),


            status:

                'OPEN',


            createdAt:

                new Date(),


            ...incident

        };


        this.incidents.push(record);


        return record;

    }



    active()
    {

        return this.incidents.filter(

            i=>i.status !== 'RESOLVED'

        );

    }



}



module.exports =
    IncidentCommandEngine;