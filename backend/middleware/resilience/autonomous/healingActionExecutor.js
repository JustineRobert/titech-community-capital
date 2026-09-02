'use strict';


class HealingActionExecutor {


    constructor(
        workflows
    )
    {

        this.workflows =
            workflows;

    }




    async execute(
        decision
    )
    {


        return this.workflows.execute(

            'DEFAULT_RECOVERY',

            decision

        );

    }



}



module.exports =
    HealingActionExecutor;