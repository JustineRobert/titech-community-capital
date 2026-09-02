'use strict';


class ResilienceSecureStore {


    constructor(repository)
    {

        this.repository =
            repository;

    }



    async save(
        key,
        value
    )
    {

        return this.repository?.set({

            key,

            value,

            updatedAt:
                new Date()

        });

    }



    async get(
        key
    )
    {

        return this.repository?.get(

            key

        );

    }



}



module.exports =
    ResilienceSecureStore;