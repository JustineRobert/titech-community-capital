'use strict';


/**
 * =============================================================================
 * MongoDB Resilience Persistence Adapter
 * =============================================================================
 */


class ResilienceMongoAdapter {


    constructor(
        model
    )
    {

        this.model =
            model;

    }




    async save(
        data
    )
    {

        return this.model.create(
            data
        );

    }




    async find(
        query={}
    )
    {

        return this.model.find(
            query
        );

    }




    async findOne(
        query
    )
    {

        return this.model.findOne(
            query
        );

    }




    async update(
        query,
        update
    )
    {

        return this.model.findOneAndUpdate(

            query,

            {

                $set:update

            },

            {

                new:true

            }

        );

    }



}



module.exports =
    ResilienceMongoAdapter;