'use strict';


class ResilienceCheckpointManager {


    constructor(
        repository
    )
    {

        this.repository =
            repository;

    }



    async checkpoint(
        workflow
    )
    {


        return this.repository.save({

            type:

                'RECOVERY_CHECKPOINT',


            workflowId:

                workflow.id,


            state:

                workflow.state,


            timestamp:

                Date.now()

        });

    }





    async restore(
        workflowId
    )
    {

        return this.repository.findOne({

            type:

                'RECOVERY_CHECKPOINT',


            workflowId

        });

    }



}



module.exports =
    ResilienceCheckpointManager;