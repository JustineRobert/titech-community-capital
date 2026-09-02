'use strict';


class ResilienceFailureRepository {


    constructor(
        repository
    )
    {

        this.repository =
            repository;

    }



    async record(
        failure
    )
    {

        return this.repository.save({

            type:

                'FAILURE_EVENT',


            ...failure,


            createdAt:

                new Date()

        });

    }



    async history(
        dependency
    )
    {

        return this.repository.find({

            type:

                'FAILURE_EVENT',


            dependency

        });

    }


}



module.exports =
    ResilienceFailureRepository;