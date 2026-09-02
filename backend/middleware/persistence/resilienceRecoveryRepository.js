'use strict';


class ResilienceRecoveryRepository {


    constructor(
        repository
    )
    {

        this.repository =
            repository;

    }




    async create(
        workflow
    )
    {


        return this.repository.save({

            type:

                'RECOVERY_WORKFLOW',


            status:

                'STARTED',


            ...workflow,


            createdAt:

                new Date()

        });

    }





    async complete(
        id,
        result
    )
    {


        return this.repository.update(

            {

                id

            },

            {

                status:

                    'COMPLETED',


                result

            }

        );

    }



}



module.exports =
    ResilienceRecoveryRepository;