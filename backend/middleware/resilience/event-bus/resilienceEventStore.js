'use strict';


class ResilienceEventStore {


    constructor(repository)
    {

        this.repository =
            repository;


    }



    async save(
        event
    )
    {


        if(!this.repository)
        {

            return event;

        }



        return this.repository.create(

            event

        );

    }



    async find(
        filter={}
    )
    {


        return this.repository?.find(

            filter

        );

    }



}



module.exports =
    ResilienceEventStore;